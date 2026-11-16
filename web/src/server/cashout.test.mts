import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.RAMP_PROVIDER = "link";
process.env.APP_URL = "https://wura.example";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
process.env.PRIVY_APP_SECRET = "privy-secret";
process.env.SESSION_SECRET = "y".repeat(40);
process.env.BETA_ALLOWLIST = "a@example.com";
process.env.DATABASE_URL = "postgres://nobody@localhost:1/none"; // mainnet won't boot without one; cleared below
for (const k of ["VERCEL_ENV", "TESTNET_SIGNER", "AGENT_KEY_SECRET", "STELLAR_USDC_ISSUER", "STELLAR_HORIZON_URL", "TESTNET_CONTACTS", "MONEY_KILL", "TREASURY_SECRET"]) delete process.env[k];

const { Keypair } = await import("@stellar/stellar-sdk");
await import("./config");
// Booted. Now no database, so the wallet lives in memory and wallet() works outside a request.
delete process.env.DATABASE_URL;
const { ApiFailure } = await import("./errors");
const { assetFor } = await import("./stellar");
const { wallet } = await import("./store");
const { EXAMPLE_LIMITS, createSend, openApproval } = await import("./money");
const { submitSigned } = await import("./testnet");
const C = await import("./cashout");
type Deps = import("./cashout").CashOutDeps;
type Payment = import("./ramp/types").CashOutPayment;

const user = Keypair.random().publicKey();
const partner = Keypair.random().publicKey();
const ngnc = assetFor("NGN")!;
let n = 0;
const session = () => ({ userId: `cashout-${++n}`, email: "a@example.com", address: user });
const refused = (code: string) => (e: unknown) => e instanceof ApiFailure && e.code === code;
const noToken = async () => undefined;

const AMOUNT = 10_000_00;
const pay = (o: Partial<Payment> = {}): Payment => ({
  id: "co-1",
  network: "mainnet",
  currency: "NGN",
  asset: { code: ngnc.getCode(), issuer: ngnc.getIssuer() },
  amount: AMOUNT,
  destination: partner,
  memo: "12345",
  memoType: "id",
  ...o,
});

/** A partner that answers with `answer()` each time it is read, and a cash-out recorded for this user. */
function deps(s: { userId: string; address: string }, answer: () => Payment | null, over: Partial<Deps> = {}): Deps & { reads: number } {
  const d = {
    reads: 0,
    payment: async () => {
      d.reads++;
      return answer();
    },
    transfer: async (k: { anchorTxId: string }) =>
      k.anchorTxId === "co-1"
        ? ({ id: "row", userId: s.userId, address: s.address, provider: "link", service: "NGN", kind: "cashout", anchorTxId: "co-1", amount: AMOUNT, state: "waiting_for_you", anchorStatus: "pending_user_transfer_start", amountIn: null, amountOut: null, fee: null, stellarTxId: null, loggedAt: null, flaggedAt: null, createdAt: Date.now() } as const)
        : null,
    balance: async () => 50_000_00,
    account: async (address: string) => ({ address, exists: true, xlm: "5", usdc: null, hasTrustline: false, ngn: 0, hasNgncTrustline: true, memoRequired: false }),
    build: async () => ({ xdr: "AAAA", hash: "ab".repeat(32) }),
    ...over,
  };
  return d as Deps & { reads: number };
}

test("a ready cash-out becomes a payment preview to the partner, with its memo", async () => {
  const s = session();
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay()));
  assert.equal(i.amount, AMOUNT);
  assert.equal(i.to.address, partner);
  assert.deepEqual(i.memo, { type: "id", value: "12345" });
  assert.deepEqual(i.cashOut, { id: "co-1", from: "NGN" });
  assert.equal(i.status, "pending");
});

test("not ready yet: nothing to preview", async () => {
  const s = session();
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => null)), refused("NOT_READY"));
});

test("the partner can't ask for more than the user started the cash-out with", async () => {
  const s = session();
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay({ amount: AMOUNT + 1 }))), /more than/);
});

test("a cash-out Wura didn't record for this user is refused", async () => {
  const s = session();
  const d = deps(s, () => pay({ id: "co-2" }));
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-2", from: "NGN" }, noToken, d), refused("INTENT_NOT_FOUND"));
  const other = deps({ userId: "someone-else", address: user }, () => pay());
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, other), refused("INTENT_NOT_FOUND"));
});

test("a different asset, or a payment to the user's own wallet, is refused", async () => {
  const s = session();
  const fake = Keypair.random().publicKey();
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay({ asset: { code: "NGNC", issuer: fake } }))), /doesn't match/);
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay({ destination: user }))), /doesn't match/);
});

test("caps and balance apply to the amount the partner asks for", async () => {
  const s = session();
  const big = EXAMPLE_LIMITS.perPayment.NGN + 1;
  const d = deps(s, () => pay({ amount: big }), {
    transfer: async () => ({ ...(await deps(s, () => null).transfer({ provider: "link", service: "NGN", anchorTxId: "co-1" }))!, amount: big }),
  });
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d), refused("LIMIT_PER_PAYMENT"));
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay(), { balance: async () => AMOUNT - 1 })), refused("INSUFFICIENT_BALANCE"));
});

test("a hash memo arrives as base64 and must be exactly 32 bytes", () => {
  const raw = Buffer.alloc(32, 7);
  assert.deepEqual(C.partnerMemo("hash", raw.toString("base64")), { type: "hash", value: raw.toString("hex") });
  assert.throws(() => C.partnerMemo("hash", Buffer.alloc(31).toString("base64")), /can't use/);
  assert.throws(() => C.partnerMemo("text", "x".repeat(29)), /can't use/);
  assert.throws(() => C.partnerMemo("id", "12a"), /can't use/);
});

test("the partner may take payment at its token's issuer, which has no trustline to itself", () => {
  const st = { address: ngnc.getIssuer(), exists: true, xlm: "1", usdc: null, hasTrustline: false, ngn: null, hasNgncTrustline: false, memoRequired: false };
  assert.equal(C.cashOutDestinationProblem(st, "NGN", { type: "id", value: "1" }), null);
  assert.ok(C.cashOutDestinationProblem({ ...st, address: partner }, "NGN", { type: "id", value: "1" }));
});

test("approve reads the partner again and refuses when the details changed", async () => {
  const s = session();
  let answer = pay();
  const d = deps(s, () => answer);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  answer = pay({ destination: Keypair.random().publicKey() });
  await assert.rejects(C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d), refused("CHANGED"));
  assert.equal(wallet(s.userId).sends.get(i.id)!.status, "cancelled");
  assert.equal(d.reads, 2);
});

test("approve needs approve: true, and builds the payment for the wallet to sign", async () => {
  const s = session();
  const d = deps(s, () => pay());
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await assert.rejects(C.approveCashOutPayment(s, { intentId: i.id, approve: "yes" }, noToken, d), refused("NOT_APPROVED"));
  const r = await C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d);
  assert.equal(r.status, "needs_signature");
  assert.equal(wallet(s.userId).pendingTx.get(r.txId)!.intentId, i.id);
});

test("before submit: the cash-out is claimed once; a second payment for it is refused", async () => {
  const s = session();
  const d = deps(s, () => pay());
  const w = wallet(s.userId);
  const a = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  const check = C.cashOutSubmitCheck(s, noToken, d);
  await check(w, a, "hash-a");
  assert.equal(w.cashOutPaid!["co-1"], "hash-a");
  await check(w, a, "hash-a"); // the same transaction again (a retry) is fine
  await assert.rejects(check(w, a, "hash-b"), refused("ALREADY_USED"));
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d), refused("ALREADY_USED"));
});

test("before submit: a changed amount stops it, and nothing is claimed", async () => {
  const s = session();
  let answer = pay();
  const d = deps(s, () => answer);
  const w = wallet(s.userId);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  answer = pay({ amount: AMOUNT - 1 });
  await assert.rejects(C.cashOutSubmitCheck(s, noToken, d)(w, i, "hash-a"), refused("CHANGED"));
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
});

test("a cash-out can't be approved by createSend (chat or web) or an approval link, or submitted through /api/tx/submit", async () => {
  const s = session();
  const d = deps(s, () => pay());
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await assert.rejects(createSend(s, { intentId: i.id, approve: true, via: "chat" }), /cash-out screen/);
  await assert.rejects(createSend(s, { intentId: i.id, approve: true }), /cash-out screen/);
  await assert.rejects(openApproval(s, i.id), /cash-out screen/);
  const r = await C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d);
  await assert.rejects(submitSigned(s, { txId: r.txId, signature: "00".repeat(64) }), /cash-out screen/);
});
