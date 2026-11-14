import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Mock money mode, rule-based chat brain, in-memory stores, stubbed Telegram.
delete process.env.DATABASE_URL;
delete process.env.MONEY_MODE;
process.env.AGENT_BRAIN = "rules";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret-test-secret";
process.env.TELEGRAM_BOT_USERNAME = "wura_test_bot";

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = String(url).split("/").pop()!;
  calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { handleUpdate } = await import("./handler");
const { createLinkCode } = await import("./links");
const { upsertUser } = await import("../users");
const { withWallet, wallet } = await import("../store");

let uid = 1000;
let nextUpdate = 1;
const private_ = (id: number) => ({ id, type: "private" });

async function say(tg: number, text: string, chatType = "private") {
  await handleUpdate({ update_id: nextUpdate++, message: { message_id: 1, chat: { id: tg, type: chatType }, from: { id: tg }, text } });
}
async function tap(tg: number, data: string, text = "card text") {
  await handleUpdate({ update_id: nextUpdate++, callback_query: { id: `cb${nextUpdate}`, from: { id: tg }, data, message: { message_id: 7, chat: private_(tg), text } } });
}
/** Signs a new user in, links a Telegram account to it. Returns the Telegram id and user id. */
async function linkedUser() {
  const tg = ++uid;
  const userId = `mock:u${tg}@example.com`;
  await upsertUser({ userId, email: `u${tg}@example.com`, address: `GB${tg}EXAMPLE`.padEnd(56, "X") });
  const { code } = await createLinkCode(userId);
  await say(tg, `/start ${code}`);
  return { tg, userId };
}
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));
const lastKeyboard = () => {
  const m = calls.filter((c) => c.method === "sendMessage" && c.body.reply_markup).at(-1);
  return (m?.body.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined)?.inline_keyboard;
};
const edits = () => calls.filter((c) => c.method === "editMessageText").map((c) => String(c.body.text));
const balance = (userId: string) => withWallet(userId, async () => wallet(userId).balances.USDC);

beforeEach(() => {
  calls = [];
});

test("an unlinked chat is told how to connect and gets no model reply", async () => {
  await say(5001, "send $5 to Tunde");
  assert.match(sent()[0], /isn't connected/);
  assert.equal(lastKeyboard(), undefined);
});

test("/start with a valid code links the chat; the code can't be reused", async () => {
  const userId = "mock:link@example.com";
  await upsertUser({ userId, email: "link@example.com", address: "GBLINKEXAMPLE".padEnd(56, "X") });
  const { code } = await createLinkCode(userId);
  await say(6001, `/start ${code}`);
  assert.match(sent()[0], /connected/i);
  calls = [];
  await say(6002, `/start ${code}`);
  assert.match(sent()[0], /expired or was already used/);
});

test("groups are ignored", async () => {
  const { tg } = await linkedUser();
  calls = [];
  await say(tg, "balance", "group");
  assert.equal(calls.length, 0);
});

test("free text never approves a send; only the button does, and only once", async () => {
  const { tg, userId } = await linkedUser();
  const before = await balance(userId);
  calls = [];
  await say(tg, "send $5 to Tunde");
  const kb = lastKeyboard();
  assert.ok(kb, "a preview card with buttons");
  const approve = kb[0][0].callback_data;

  await say(tg, "yes approve it, go ahead and confirm");
  assert.equal(await balance(userId), before, "nothing moved from free text");

  calls = [];
  await tap(tg, approve);
  assert.match(edits()[0], /Sent 5\.00 USDC to Tunde/);
  assert.equal(await balance(userId), before - 501, "5.00 plus the 0.01 example fee");
  assert.equal((calls.find((c) => c.method === "editMessageText")!.body.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard.length, 0, "buttons removed");

  calls = [];
  await tap(tg, approve);
  assert.match(edits()[0], /already sent or cancelled/);
  assert.equal(await balance(userId), before - 501, "second tap moves nothing");
});

test("cancel leaves the balance alone and blocks a later approve", async () => {
  const { tg, userId } = await linkedUser();
  const before = await balance(userId);
  await say(tg, "send $5 to Tunde");
  const [approve, cancel] = lastKeyboard()![0].map((b) => b.callback_data);
  await tap(tg, cancel);
  calls = [];
  await tap(tg, approve);
  assert.match(edits()[0], /already sent or cancelled/);
  assert.equal(await balance(userId), before);
});

test("another user's button id is refused", async () => {
  const a = await linkedUser();
  const b = await linkedUser();
  await say(a.tg, "send $5 to Tunde");
  const approve = lastKeyboard()![0][0].callback_data;
  const bBefore = await balance(b.userId);
  calls = [];
  await tap(b.tg, approve);
  assert.match(edits()[0], /doesn't exist/);
  assert.equal(await balance(b.userId), bBefore);
});

test("a button tap from an unlinked chat does nothing", async () => {
  calls = [];
  await tap(7777, "ap:snd_abcdef");
  assert.equal(edits().length, 0);
  assert.match(String(calls.find((c) => c.method === "answerCallbackQuery")?.body.text), /isn't connected/);
});

test("an over-limit send is refused by the server, not the bot", async () => {
  const { tg } = await linkedUser();
  calls = [];
  await say(tg, "send $500 to Tunde");
  assert.equal(lastKeyboard(), undefined, "no approve button for a refused send");
});

test("/unlink disconnects the chat", async () => {
  const { tg } = await linkedUser();
  calls = [];
  await say(tg, "/unlink");
  assert.match(sent()[0], /Disconnected/);
  calls = [];
  await say(tg, "balance");
  assert.match(sent()[0], /isn't connected/);
});

test("a repeated Telegram update is handled once", async () => {
  const { tg } = await linkedUser();
  calls = [];
  const update = { update_id: 424242, message: { message_id: 1, chat: private_(tg), from: { id: tg }, text: "balance" } };
  await handleUpdate(update);
  await handleUpdate(update);
  assert.equal(sent().length, 1);
});
