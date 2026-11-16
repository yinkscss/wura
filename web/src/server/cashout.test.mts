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
type SignIn = import("./ramp/types").PartnerSignIn;
const signIn: SignIn = { status: "needs_partner_signin", receive: "NGN", hash: "00", address: "G", challenge: "c", expiresAt: 0 };

const userKey = Keypair.random();
const user = userKey.publicKey();
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
/** `held` stands in for ramp_transfers.stellar_tx_id: the payment that claimed the cash-out. */
function deps(s: { userId: string; address: string }, answer: () => Payment | SignIn | null, over: Partial<Deps> = {}): Deps & { reads: number; held: string | null } {
  const d = {
    reads: 0,
    held: null as string | null,
    payment: async () => {
      d.reads++;
      return answer();
    },
    transfer: async (k: { anchorTxId: string }): Promise<import("./ramp/records").TransferRow | null> =>
      k.anchorTxId === "co-1"
        ? ({ id: "row", userId: s.userId, address: s.address, provider: "link", service: "NGN", kind: "cashout", anchorTxId: "co-1", amount: AMOUNT, state: "waiting_for_you", anchorStatus: "pending_user_transfer_start", amountIn: null, amountOut: null, fee: null, stellarTxId: d.held, loggedAt: null, flaggedAt: null, createdAt: Date.now() } as const)
        : null,
    balance: async () => 50_000_00,
    account: async (address: string) => ({ address, exists: true, xlm: "5", usdc: null, hasTrustline: false, ngn: 0, hasNgncTrustline: true, memoRequired: false }),
    build: async () => ({ xdr: "AAAA", hash: "ab".repeat(32) }),
    claim: async (k: { anchorTxId: string }, hash: string) => {
      if (k.anchorTxId !== "co-1" || (d.held && d.held !== hash)) return false;
      d.held = hash;
      return true;
    },
    release: async (_k: unknown, hash: string) => {
      if (d.held === hash) d.held = null;
    },
    ...over,
  };
  return d as Deps & { reads: number; held: string | null };
}

test("a ready cash-out becomes a payment preview to the partner, with its memo", async () => {
  const s = session();
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, deps(s, () => pay()));
  assert.equal(i.amount, AMOUNT);
  assert.equal(i.to.address, partner);
  assert.deepEqual(i.memo, { type: "id", value: "12345" });
  assert.deepEqual(i.cashOut, { id: "co-1", from: "NGN", fee: null, receive: null });
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
  const { check } = C.cashOutSubmitCheck(s, noToken, d);
  await check(w, a, "hash-a");
  assert.equal(w.cashOutPaid!["co-1"], "hash-a");
  assert.equal(d.held, "hash-a");
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
  await assert.rejects(C.cashOutSubmitCheck(s, noToken, d).check(w, i, "hash-a"), refused("CHANGED"));
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
  assert.equal(d.held, null);
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

test("before submit: a preview that was replaced can't be paid with its old signature", async () => {
  const s = session();
  const d = deps(s, () => pay());
  const w = wallet(s.userId);
  const first = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await C.approveCashOutPayment(s, { intentId: first.id, approve: true }, noToken, d);
  await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d); // a fresh look replaces it
  await assert.rejects(C.cashOutSubmitCheck(s, noToken, d).check(w, first, "hash-a"), refused("ALREADY_USED"));
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
});

test("a claim saved before a timeout still holds when the wallet's own record of it was lost", async () => {
  const s = session();
  const d = deps(s, () => pay());
  d.held = "hash-x"; // the server died mid-submit: the row kept the claim, the wallet state didn't
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d), refused("ALREADY_USED"));
  // A preview made before the claim can't be paid by a different transaction, but the claiming one can retry.
  const d2 = deps(s, () => pay());
  const w = wallet(s.userId);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d2);
  d2.held = "hash-x";
  const { check } = C.cashOutSubmitCheck(s, noToken, d2);
  await assert.rejects(check(w, i, "hash-a"), refused("ALREADY_USED"));
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
  await check(w, i, "hash-x");
  assert.equal(w.cashOutPaid!["co-1"], "hash-x");
});

test("a claim lost to another payment at the last moment stops the submit", async () => {
  const s = session();
  const d = deps(s, () => pay(), { claim: async () => false });
  const w = wallet(s.userId);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await assert.rejects(C.cashOutSubmitCheck(s, noToken, d).check(w, i, "hash-a"), refused("ALREADY_USED"));
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
});

test("after a definite rejection the claim is given back, and a new payment can pay the cash-out", async () => {
  const s = session();
  const d = deps(s, () => pay());
  const w = wallet(s.userId);
  const hooks = C.cashOutSubmitCheck(s, noToken, d);
  const a = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await hooks.check(w, a, "hash-a");
  await hooks.release(w, a, "hash-b"); // only the holder can release
  assert.equal(d.held, "hash-a");
  await hooks.release(w, a, "hash-a");
  assert.equal(d.held, null);
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
  const b = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  await hooks.check(w, b, "hash-b");
  assert.equal(d.held, "hash-b");
});

test("a hash memo builds into the transaction as the partner's 32 bytes", async () => {
  const { Account, Operation } = await import("@stellar/stellar-sdk");
  const { buildTx, toMemo } = await import("./stellar");
  const raw = Buffer.alloc(32, 9);
  const memo = C.partnerMemo("hash", raw.toString("base64"));
  const op = Operation.payment({ destination: partner, asset: ngnc, amount: "1.0000000" });
  const built = buildTx(new Account(user, "1"), op, toMemo(memo as { type: "hash"; value: string }));
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const tx = TransactionBuilder.fromXDR(built.xdr, "Public Global Stellar Network ; September 2015") as import("@stellar/stellar-sdk").Transaction;
  assert.equal(tx.memo.type, "hash");
  assert.deepEqual(Buffer.from(tx.memo.value as Buffer), raw);
});

test("an expired partner sign-in asks for a new one, at every step, and cancels nothing", async () => {
  const s = session();
  let answer: Payment | SignIn = signIn;
  const d = deps(s, () => answer);
  const w = wallet(s.userId);
  assert.deepEqual(await C.orPartnerSignIn(() => C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d)), signIn);
  answer = pay();
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  answer = signIn;
  assert.deepEqual(await C.orPartnerSignIn(() => C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d)), signIn);
  assert.equal(w.sends.get(i.id)!.status, "pending");
  const { check } = C.cashOutSubmitCheck(s, noToken, d);
  await assert.rejects(check(w, i, "hash-a"), (e: unknown) => e instanceof C.PartnerSignInNeeded && e.code === "PARTNER_SIGNIN");
  assert.equal(w.cashOutPaid?.["co-1"], undefined);
  assert.equal(d.held, null);
  assert.equal(w.sends.get(i.id)!.status, "pending");
  answer = pay(); // signed in again: the same signed payment goes ahead
  await check(w, i, "hash-a");
  assert.equal(d.held, "hash-a");
});

test("the partner's fee and what reaches the bank are shown, must add up, and can't change after the preview", async () => {
  const s = session();
  let answer = pay({ fee: 200_00, receive: { amount: AMOUNT - 200_00, currency: "NGN" } });
  const d = deps(s, () => answer);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  assert.deepEqual(i.cashOut, { id: "co-1", from: "NGN", fee: 200_00, receive: { amount: AMOUNT - 200_00, currency: "NGN" } });
  answer = pay({ fee: 300_00, receive: { amount: AMOUNT - 300_00, currency: "NGN" } });
  await assert.rejects(C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d), refused("CHANGED"));
  answer = pay({ fee: 200_00, receive: { amount: AMOUNT, currency: "NGN" } });
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d), /doesn't match/);
  answer = pay({ fee: AMOUNT });
  await assert.rejects(C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d), /doesn't match/);
  // A dollar cash-out pays naira to the bank, so the two aren't compared.
  const usdc = assetFor("USDC")!;
  answer = pay({ currency: "USDC", asset: { code: usdc.getCode(), issuer: usdc.getIssuer() }, amount: 10_00, fee: 0, receive: { amount: 14_000_00, currency: "NGN" } });
  const t = await deps(s, () => null).transfer({ provider: "link", service: "NGN", anchorTxId: "co-1" });
  const du = deps(s, () => answer, {
    transfer: async () => ({ ...t!, service: "USDC", amount: 10_00 }),
    balance: async () => 100_00,
    account: async (address: string) => ({ address, exists: true, xlm: "5", usdc: 0, hasTrustline: true, ngn: null, hasNgncTrustline: false, memoRequired: false }),
  });
  const u = await C.prepareCashOutPayment(s, { id: "co-1", from: "USDC" }, noToken, du);
  assert.deepEqual(u.cashOut?.receive, { amount: 14_000_00, currency: "NGN" });
});

test("submitSigned: a lapsed sign-in stops a correctly signed payment before anything is claimed or sent", async () => {
  const s = session();
  let answer: Payment | SignIn = pay();
  const d = deps(s, () => answer);
  const i = await C.prepareCashOutPayment(s, { id: "co-1", from: "NGN" }, noToken, d);
  const r = await C.approveCashOutPayment(s, { intentId: i.id, approve: true }, noToken, d);
  const p = wallet(s.userId).pendingTx.get(r.txId)!;
  const signature = userKey.sign(Buffer.from(p.hash, "hex")).toString("hex");
  answer = signIn;
  const out = await C.orPartnerSignIn(() => submitSigned(s, { txId: r.txId, signature }, { cashOut: C.cashOutSubmitCheck(s, noToken, d) }));
  assert.deepEqual(out, signIn);
  // So the same signature can be posted again after the new sign-in (that retry reaches Horizon, so it isn't run here).
  assert.equal(p.status, "pending");
  assert.equal(p.signedXdr, undefined);
  assert.equal(d.held, null);
  assert.equal(wallet(s.userId).sends.get(i.id)!.status, "pending");
});
