import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { assertSetupTx, buildSetupTx, sponsorCostXlm } from "./sponsorship";

const treasury = Keypair.random();
const user = Keypair.random();
const other = Keypair.random();
const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
const NGNC = new Asset("NGNC", "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6");
const EVIL = new Asset("USDC", other.publicKey());

const plan = (over: Partial<Parameters<typeof buildSetupTx>[0]> = {}) => ({
  treasury: new Account(treasury.publicKey(), "100"),
  user: user.publicKey(),
  userExists: false,
  assets: [USDC, NGNC],
  startingXlm: "0.5",
  passphrase: Networks.PUBLIC,
  timeoutSec: 120,
  ...over,
});
const limits = (over = {}) => ({ treasury: treasury.publicKey(), user: user.publicKey(), allowedAssets: [USDC, NGNC], maxStartingXlm: "0.5", ...over });
const types = (tx: Transaction) => tx.operations.map((o) => o.type);
const refused = (re: RegExp) => (e: unknown) => e instanceof Error && re.test(e.message) && /treasury/.test(e.message);

test("a new user: sponsor, create, two trustlines, end, in order, treasury as source", () => {
  const tx = buildSetupTx(plan());
  assert.equal(tx.source, treasury.publicKey());
  assert.deepEqual(types(tx), ["beginSponsoringFutureReserves", "createAccount", "changeTrust", "changeTrust", "endSponsoringFutureReserves"]);
  const [begin, create, t1, t2, end] = tx.operations as unknown as Array<Record<string, unknown>>;
  assert.equal(begin.sponsoredId, user.publicKey());
  assert.equal(begin.source, treasury.publicKey());
  assert.equal(create.destination, user.publicKey());
  assert.equal(create.startingBalance, "0.5000000");
  assert.equal(t1.source, user.publicKey());
  assert.equal(t2.source, user.publicKey());
  assert.equal(end.source, user.publicKey());
  assert.doesNotThrow(() => assertSetupTx(tx, limits()));
});

test("testnet: USDC only", () => {
  const tx = buildSetupTx(plan({ assets: [USDC], passphrase: Networks.TESTNET }));
  assert.deepEqual(types(tx), ["beginSponsoringFutureReserves", "createAccount", "changeTrust", "endSponsoringFutureReserves"]);
});

test("an existing account gets only the missing trustlines, no createAccount", () => {
  const tx = buildSetupTx(plan({ userExists: true, assets: [NGNC] }));
  assert.deepEqual(types(tx), ["beginSponsoringFutureReserves", "changeTrust", "endSponsoringFutureReserves"]);
  assert.doesNotThrow(() => assertSetupTx(tx, limits()));
});

test("nothing to do is an error, not an empty transaction", () => {
  assert.throws(() => buildSetupTx(plan({ userExists: true, assets: [] })), /Nothing to set up/);
});

test("the transaction has a time limit", () => {
  const tx = buildSetupTx(plan());
  assert.notEqual(tx.timeBounds?.maxTime, "0");
});

test("the treasury signature and the user's both attach to one hash", () => {
  const tx = buildSetupTx(plan());
  tx.sign(treasury);
  const xdr = tx.toXDR();
  const round = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
  round.addSignature(user.publicKey(), user.sign(round.hash()).toString("base64"));
  assert.equal(round.signatures.length, 2);
  assert.equal(round.hash().toString("hex"), tx.hash().toString("hex"));
});

test("the guard refuses a payment", () => {
  const tx = new TransactionBuilder(new Account(treasury.publicKey(), "1"), { fee: "200", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "100" }))
    .setTimeout(60)
    .build();
  assert.throws(() => assertSetupTx(tx, limits()), refused(/./));
});

test("the guard refuses a sponsorship for a different wallet", () => {
  const tx = buildSetupTx(plan({ user: other.publicKey() }));
  assert.throws(() => assertSetupTx(tx, limits()), refused(/sponsoring the signed-in wallet/));
});

test("the guard refuses a trustline for an unsupported asset", () => {
  const tx = buildSetupTx(plan({ assets: [EVIL] }));
  assert.throws(() => assertSetupTx(tx, limits()), refused(/asset we don't support/));
});

test("the guard refuses a starting balance above the cap", () => {
  const tx = buildSetupTx(plan({ startingXlm: "100" }));
  assert.throws(() => assertSetupTx(tx, limits()), refused(/starting balance/));
});

test("the guard refuses a transaction not sourced by the treasury", () => {
  const tx = buildSetupTx(plan());
  assert.throws(() => assertSetupTx(tx, limits({ treasury: other.publicKey() })), refused(/source/));
});

test("the guard refuses a repeated trustline and a stray operation", () => {
  assert.throws(() => assertSetupTx(buildSetupTx(plan({ assets: [USDC, USDC] })), limits()), refused(/repeated/));
  const stray = new TransactionBuilder(new Account(treasury.publicKey(), "1"), { fee: "200", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: user.publicKey(), source: treasury.publicKey() }))
    .addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "5", source: user.publicKey() }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: user.publicKey() }))
    .setTimeout(60)
    .build();
  assert.throws(() => assertSetupTx(stray, limits()), refused(/unexpected payment/));
});

test("per-user cost: 1 XLM account + fee balance + 0.5 per trustline", () => {
  assert.equal(sponsorCostXlm({ newAccount: true, trustlines: 2, startingXlm: "0.5" }), 2.5);
  assert.equal(sponsorCostXlm({ newAccount: false, trustlines: 1, startingXlm: "0.5" }), 0.5);
});
