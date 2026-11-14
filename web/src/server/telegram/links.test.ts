import assert from "node:assert/strict";
import { test } from "node:test";
import { addToHistory, allowMessage, consumeLinkCode, createLinkCode, firstSight, getHistory, isLinked, linkedUserId, unlinkUser } from "./links";

// No DATABASE_URL here, so these run against the in-memory store.
delete process.env.DATABASE_URL;

test("a link code works once and links the Telegram user", async () => {
  const { code } = await createLinkCode("user-a");
  assert.equal(await consumeLinkCode(code, 111), "user-a");
  assert.equal(await linkedUserId(111), "user-a");
  assert.equal(await isLinked("user-a"), true);
  assert.equal(await consumeLinkCode(code, 222), null, "reused code is refused");
  assert.equal(await linkedUserId(222), null);
});

test("unknown and expired codes are refused", async () => {
  assert.equal(await consumeLinkCode("nope", 333), null);
  const { code } = await createLinkCode("user-b");
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    assert.equal(await consumeLinkCode(code, 333), null);
  } finally {
    Date.now = realNow;
  }
});

test("a new code replaces the user's earlier one", async () => {
  const first = await createLinkCode("user-c");
  const second = await createLinkCode("user-c");
  assert.equal(await consumeLinkCode(first.code, 444), null);
  assert.equal(await consumeLinkCode(second.code, 444), "user-c");
});

test("relinking moves the user to the new Telegram account", async () => {
  const a = await createLinkCode("user-d");
  await consumeLinkCode(a.code, 555);
  const b = await createLinkCode("user-d");
  await consumeLinkCode(b.code, 556);
  assert.equal(await linkedUserId(555), null);
  assert.equal(await linkedUserId(556), "user-d");
});

test("unlink removes the link and its history", async () => {
  const { code } = await createLinkCode("user-e");
  await consumeLinkCode(code, 666);
  await addToHistory(666, [{ role: "user", text: "hi" }]);
  assert.equal((await getHistory(666)).length, 1);
  assert.equal(await unlinkUser("user-e"), true);
  assert.equal(await linkedUserId(666), null);
  assert.deepEqual(await getHistory(666), []);
  assert.equal(await unlinkUser("user-e"), false);
});

test("history keeps only the last 8 lines", async () => {
  const { code } = await createLinkCode("user-f");
  await consumeLinkCode(code, 777);
  for (let i = 0; i < 10; i++) await addToHistory(777, [{ role: "user", text: `m${i}` }]);
  const h = await getHistory(777);
  assert.equal(h.length, 8);
  assert.equal(h.at(-1)?.text, "m9");
});

test("rate limit allows 20 a minute, then refuses", async () => {
  for (let i = 0; i < 20; i++) assert.equal(await allowMessage(888), true, `message ${i + 1}`);
  assert.equal(await allowMessage(888), false);
  assert.equal(await allowMessage(889), true, "other users are unaffected");
});

test("a repeated update_id is only handled once", async () => {
  assert.equal(await firstSight(9001), true);
  assert.equal(await firstSight(9001), false);
  assert.equal(await firstSight(9002), true);
});
