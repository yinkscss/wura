import assert from "node:assert/strict";
import { test } from "node:test";
import { fromMinor, getInfo, getTransfer, startInteractive, toMinor } from "./sep24";

const SERVER = "https://anchor.ngnc.online/sep24";
const json = (body: unknown, status = 200) => async () => Response.json(body, { status });

test("amounts convert without floating point drift", () => {
  assert.equal(toMinor("20000.0"), 2_000_000);
  assert.equal(toMinor(20000), 2_000_000);
  assert.equal(toMinor("0.07"), 7);
  assert.equal(toMinor("1.239"), 123);
  assert.equal(toMinor("-5"), null);
  assert.equal(toMinor("1e9"), null);
  assert.equal(toMinor(undefined), null);
  assert.equal(fromMinor(2_000_000), "20000.00");
  assert.equal(fromMinor(7), "0.07");
  assert.throws(() => fromMinor(1.5));
});

test("getInfo reads the limits LINK published on 13 Nov 2026", async () => {
  const body = {
    deposit: { NGNC: { enabled: true, min_amount: 20000.0, max_amount: 20000000.0 } },
    withdraw: { NGNC: { enabled: true, min_amount: 10000.0, max_amount: 5000000.0 } },
    fee: { enabled: true },
  };
  assert.deepEqual(await getInfo(SERVER, "NGNC", { fetch: json(body) }), {
    deposit: { enabled: true, min: 2_000_000, max: 2_000_000_000 },
    withdraw: { enabled: true, min: 1_000_000, max: 500_000_000 },
    feeEndpoint: true,
  });
  const other = await getInfo(SERVER, "USDC", { fetch: json(body) });
  assert.equal(other.deposit.enabled, false);
  await assert.rejects(getInfo(SERVER, "NGNC", { fetch: json({ error: "down" }, 503) }), /503.*down/);
});

const start = (reply: typeof fetch, kind: "deposit" | "withdraw" = "deposit") =>
  startInteractive(
    kind,
    { transferServer: SERVER, homeDomain: "ngnc.online", token: "tok", assetCode: "NGNC", assetIssuer: "GISSUER", account: "GUSER", amount: 2_000_000 },
    { fetch: reply },
  );

test("startInteractive sends the right request and returns the hosted page", async () => {
  let seen = { url: "", auth: "", body: null as unknown };
  const out = await start(async (url, init) => {
    seen = { url: String(url), auth: (init?.headers as Record<string, string>).Authorization, body: JSON.parse(String(init?.body)) };
    return Response.json({ type: "interactive_customer_info_needed", id: "abc", url: "https://anchor.ngnc.online/sep24/webapp?t=1" });
  });
  assert.deepEqual(out, { id: "abc", url: "https://anchor.ngnc.online/sep24/webapp?t=1" });
  assert.equal(seen.url, `${SERVER}/transactions/deposit/interactive`);
  assert.equal(seen.auth, "Bearer tok");
  assert.deepEqual(seen.body, { asset_code: "NGNC", asset_issuer: "GISSUER", account: "GUSER", amount: "20000.00", lang: "en" });
});

test("startInteractive refuses a page off the anchor's domain", async () => {
  const page = (url: string) => json({ type: "interactive_customer_info_needed", id: "abc", url });
  await assert.rejects(start(page("https://evil.example/kyc")), /own domain/);
  await assert.rejects(start(page("http://anchor.ngnc.online/x")), /own domain/);
  await assert.rejects(start(page("https://ngnc.online.evil.example/x")), /own domain/);
  await assert.rejects(start(page("javascript:alert(1)")), /own domain/);
  await assert.rejects(start(json({ type: "something_else" })), /not a hosted page/);
  await assert.rejects(start(json({ error: "bad token" }, 403)), /403.*bad token/);
});

const transfer = (t: Record<string, unknown>) => getTransfer({ transferServer: SERVER, token: "tok", id: "abc" }, { fetch: json({ transaction: { id: "abc", ...t } }) });

test("getTransfer maps anchor statuses to plain states", async () => {
  assert.equal((await transfer({ kind: "deposit", status: "incomplete" })).state, "waiting_for_you");
  assert.equal((await transfer({ kind: "deposit", status: "pending_anchor" })).state, "processing");
  assert.equal((await transfer({ kind: "deposit", status: "error" })).state, "failed");
  assert.equal((await transfer({ kind: "deposit", status: "brand_new_status" })).state, "processing");
  const done = await transfer({ kind: "deposit", status: "completed", amount_in: "20000.00", amount_out: "19800.00", amount_fee: "200", stellar_transaction_id: "ff" });
  assert.deepEqual(
    { state: done.state, in: done.amountIn, out: done.amountOut, fee: done.fee, tx: done.stellarTxId, payTo: done.payTo },
    { state: "done", in: 2_000_000, out: 1_980_000, fee: 20_000, tx: "ff", payTo: null },
  );
});

test("getTransfer exposes where to pay only when the anchor is ready for a withdrawal", async () => {
  const w = { kind: "withdrawal", withdraw_anchor_account: "GANCHOR", withdraw_memo: "123", withdraw_memo_type: "id" };
  assert.deepEqual((await transfer({ ...w, status: "pending_user_transfer_start" })).payTo, { account: "GANCHOR", memo: "123", memoType: "id" });
  assert.equal((await transfer({ ...w, status: "incomplete" })).payTo, null);
  assert.equal((await transfer({ ...w, status: "pending_user_transfer_start", withdraw_memo_type: "weird" })).payTo, null);
  assert.equal((await transfer({ ...w, kind: "deposit", status: "pending_user_transfer_start" })).payTo, null);
});

test("getTransfer refuses a reply about another transfer", async () => {
  await assert.rejects(
    getTransfer({ transferServer: SERVER, token: "tok", id: "abc" }, { fetch: json({ transaction: { id: "zzz", status: "completed" } }) }),
    /different transfer/,
  );
});
