import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.APP_URL = "https://wura.example";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
process.env.PRIVY_APP_SECRET = "privy-secret";
process.env.DATABASE_URL = "postgres://nobody@localhost:1/none"; // never connected: these tests don't touch the database
process.env.SESSION_SECRET = "y".repeat(40);
for (const k of ["VERCEL_ENV", "TESTNET_SIGNER", "AGENT_KEY_SECRET", "STELLAR_USDC_ISSUER", "STELLAR_HORIZON_URL", "TESTNET_CONTACTS", "MONEY_KILL", "TREASURY_SECRET"]) delete process.env[k];

import type { Transaction } from "@stellar/stellar-sdk";
const { Account, Keypair, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
const { buildTx, submitWith, SubmitUnconfirmed, isMemoRequired, assetFor } = await import("./stellar");
const { destinationProblem } = await import("./testnet");
const { cleanMemo } = await import("./money");
const { ApiFailure } = await import("./errors");

const kp = Keypair.random();
const to = Keypair.random().publicKey();
const mk = () => {
  const op = Operation.payment({ destination: to, asset: assetFor("USDC") as NonNullable<ReturnType<typeof assetFor>>, amount: "1.0000000" });
  const built = buildTx(new Account(kp.publicKey(), "1"), op);
  return TransactionBuilder.fromXDR(built.xdr, "Public Global Stellar Network ; September 2015") as Transaction;
};

const horizonError = (codes?: { transaction?: string; operations?: string[] }, status = 400) =>
  Object.assign(new Error("horizon"), { response: { status, data: codes ? { extras: { result_codes: codes } } : {} } });
const notFound = () => Object.assign(new Error("nf"), { response: { status: 404 } });
const fake = (o: { submit: () => Promise<{ hash: string }>; outcome?: () => Promise<{ successful?: boolean }> }) => ({
  submitTransaction: async () => o.submit(),
  transactions: () => ({ transaction: () => ({ call: async () => (o.outcome ? o.outcome() : Promise.reject(notFound())) }) }),
});
const fast = { pollMs: 0, polls: 2 };

test("time bound: every built transaction has a deadline", () => {
  const tx = mk();
  assert.ok(tx.timeBounds && tx.timeBounds.maxTime !== "0");
});

test("a normal submit returns the hash", async () => {
  const tx = mk();
  assert.equal(await submitWith(fake({ submit: async () => ({ hash: "h1" }) }), tx, fast), "h1");
});

test("a real rejection is an error and is not retried or looked up", async () => {
  let looked = 0;
  const h = fake({ submit: async () => { throw horizonError({ transaction: "tx_failed", operations: ["op_underfunded"] }, 400); }, outcome: async () => { looked++; return {}; } });
  await assert.rejects(submitWith(h, mk(), fast), (e: unknown) => e instanceof ApiFailure && /enough USDC/.test(e.message));
  assert.equal(looked, 0);
});

test("a timeout where the transaction actually landed counts as sent, once", async () => {
  const tx = mk();
  const h = fake({ submit: async () => { throw horizonError(undefined, 504); }, outcome: async () => ({ successful: true }) });
  assert.equal(await submitWith(h, tx, fast), tx.hash().toString("hex"));
});

test("a timeout where nothing landed is unconfirmed, not failed", async () => {
  const h = fake({ submit: async () => { throw horizonError(undefined, 504); } });
  await assert.rejects(submitWith(h, mk(), fast), (e: unknown) => e instanceof SubmitUnconfirmed);
});

test("a timeout where the transaction failed on chain is a failure", async () => {
  const h = fake({ submit: async () => { throw horizonError(undefined, 504); }, outcome: async () => ({ successful: false }) });
  await assert.rejects(submitWith(h, mk(), fast), (e: unknown) => e instanceof ApiFailure);
});

test("a resubmit of a landed transaction (tx_bad_seq) returns the same hash instead of an error", async () => {
  const tx = mk();
  const h = fake({ submit: async () => { throw horizonError({ transaction: "tx_bad_seq" }); }, outcome: async () => ({ successful: true }) });
  assert.equal(await submitWith(h, tx, fast), tx.hash().toString("hex"));
});

test("tx_bad_seq for a transaction that never landed is still an error", async () => {
  const h = fake({ submit: async () => { throw horizonError({ transaction: "tx_bad_seq" }); } });
  await assert.rejects(submitWith(h, mk(), fast), (e: unknown) => e instanceof ApiFailure && /went through first/.test(e.message));
});

test("SEP-29: memo_required data entry is detected", () => {
  assert.equal(isMemoRequired({ "config.memo_required": "MQ==" }), true);
  assert.equal(isMemoRequired({ "config.memo_required": "MA==" }), false);
  assert.equal(isMemoRequired({}), false);
  assert.equal(isMemoRequired(undefined), false);
});

const st = (o = {}) => ({ address: "G", exists: true, xlm: "1", usdc: 0, hasTrustline: true, ngn: 0, hasNgncTrustline: true, memoRequired: false, ...o });

test("destination checks: missing account, missing trustline, memo required", () => {
  assert.equal(destinationProblem(st(), "Ada", "USDC"), null);
  assert.match(destinationProblem(st({ exists: false }), "Ada", "USDC")!.message, /doesn't exist/);
  assert.match(destinationProblem(st({ hasTrustline: false }), "Ada", "USDC")!.message, /no trustline/);
  assert.match(destinationProblem(st({ hasNgncTrustline: false }), "Ada", "NGN")!.message, /naira/);
  assert.equal(destinationProblem(st({ hasNgncTrustline: false }), "Ada", "USDC"), null);
  assert.match(destinationProblem(st({ memoRequired: true }), "Kuda", "USDC")!.message, /needs a memo/);
  assert.equal(destinationProblem(st({ memoRequired: true }), "Kuda", "USDC", { type: "text", value: "123" }), null);
});

test("memo input: text up to 28 bytes, ids are whole numbers, blank means none", () => {
  assert.equal(cleanMemo(undefined), undefined);
  assert.equal(cleanMemo({ type: "text", value: "  " }), undefined);
  assert.deepEqual(cleanMemo({ type: "text", value: " rent " }), { type: "text", value: "rent" });
  assert.deepEqual(cleanMemo({ type: "id", value: "42" }), { type: "id", value: "42" });
  assert.throws(() => cleanMemo({ type: "id", value: "4x2" }), ApiFailure);
  assert.throws(() => cleanMemo({ type: "text", value: "x".repeat(29) }), ApiFailure);
});
