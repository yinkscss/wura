import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.SESSION_SECRET = "y".repeat(40);
for (const k of ["VERCEL_ENV", "TESTNET_SIGNER", "AGENT_KEY_SECRET", "STELLAR_USDC_ISSUER", "STELLAR_HORIZON_URL", "TESTNET_CONTACTS", "MONEY_KILL"]) delete process.env[k];

import type { Transaction } from "@stellar/stellar-sdk";
const { Account, Keypair, Memo, Operation, TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
const { assetFor, buildPayment, buildTx, buildTrustline, centsToAmount, toMemo, verifySignature, attachSignature } = await import("./stellar");
const { LINK } = await import("./ramp/link");
const { ApiFailure } = await import("./errors");

const alice = Keypair.random();
const bob = Keypair.random();

test("NGNC uses the issuer LINK pins, USDC uses Circle's mainnet one", () => {
  const n = assetFor("NGN")!;
  assert.equal(n.getCode(), "NGNC");
  assert.equal(n.getIssuer(), LINK.NGN.asset.issuer);
  const u = assetFor("USDC")!;
  assert.equal(u.getIssuer(), "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
});

test("an NGNC payment with a text memo builds on the public network and its signature verifies", () => {
  const op = Operation.payment({ destination: bob.publicKey(), asset: assetFor("NGN")!, amount: centsToAmount(1_000_000) });
  const built = buildTx(new Account(alice.publicKey(), "100"), op, toMemo({ type: "text", value: "wd-123" }));
  const tx = TransactionBuilder.fromXDR(built.xdr, Networks.PUBLIC) as Transaction;
  assert.equal(tx.memo.type, "text");
  assert.equal(tx.memo.value?.toString(), "wd-123");
  const o = tx.operations[0] as { type: string; asset: { code: string; issuer: string }; amount: string };
  assert.equal(o.type, "payment");
  assert.equal(o.asset.code, "NGNC");
  assert.equal(o.amount, "10000.0000000");
  // Sign the hash as the user's wallet would, then attach and verify.
  const sig = alice.sign(Buffer.from(built.hash, "hex")).toString("hex");
  assert.equal(verifySignature(alice.publicKey(), built.hash, sig), true);
  assert.equal(verifySignature(bob.publicKey(), built.hash, sig), false);
  const signed = attachSignature(built.xdr, alice.publicKey(), sig);
  assert.equal(signed.signatures.length, 1);
  assert.equal(signed.hash().toString("hex"), built.hash);
});

test("memo types: id and hash work, bad ones are refused", () => {
  assert.equal(toMemo({ type: "id", value: "12345" }).type, "id");
  assert.equal(toMemo({ type: "hash", value: "ab".repeat(32) }).type, "hash");
  const bad = (e: unknown) => e instanceof ApiFailure && e.code === "BAD_REQUEST";
  assert.throws(() => toMemo({ type: "id", value: "-1" }), bad);
  assert.throws(() => toMemo({ type: "id", value: "18446744073709551616" }), bad);
  assert.throws(() => toMemo({ type: "hash", value: "xyz" }), bad);
  assert.throws(() => toMemo({ type: "text", value: "é".repeat(15) }), bad);
  assert.ok(toMemo({ type: "text", value: "x".repeat(28) }) instanceof Memo);
});

test("the NGNC trustline is a changeTrust on the pinned asset", () => {
  assert.equal(typeof buildTrustline, "function");
  const op = Operation.changeTrust({ asset: assetFor("NGN")! });
  const built = buildTx(new Account(alice.publicKey(), "7"), op);
  const tx = TransactionBuilder.fromXDR(built.xdr, Networks.PUBLIC) as Transaction;
  const o = tx.operations[0] as { type: string; line: { code: string; issuer: string } };
  assert.equal(o.type, "changeTrust");
  assert.equal(o.line.code, "NGNC");
  assert.equal(o.line.issuer, LINK.NGN.asset.issuer);
  assert.equal(tx.memo.type, "none");
});

test("buildPayment honours the kill switch before touching the network", async () => {
  process.env.MONEY_KILL = "1";
  await assert.rejects(
    buildPayment({ from: alice.publicKey(), to: bob.publicKey(), currency: "NGN", cents: 100 }),
    (e: unknown) => e instanceof ApiFailure && e.code === "MONEY_PAUSED",
  );
  delete process.env.MONEY_KILL;
});
