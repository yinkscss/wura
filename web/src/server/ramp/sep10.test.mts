import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Asset, BASE_FEE, Keypair, Memo, Networks, Operation, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";
import { checkChallenge, exchangeChallenge, readAnchorToken, signChallenge } from "../../src/server/ramp/sep10.ts";

const NET = Networks.PUBLIC;
const server = Keypair.random();
const user = Keypair.random();
const HOME = "ngnc.online";
const WEB = "anchor.ngnc.online";
const expect = { account: user.publicKey(), signingKey: server.publicKey(), networkPassphrase: NET, homeDomain: HOME, webAuthDomain: WEB };

const good = (opts = {}) =>
  WebAuth.buildChallengeTx(opts.server ?? server, opts.account ?? user.publicKey(), opts.home ?? HOME, opts.timeout ?? 300, NET, opts.web ?? WEB, opts.memo ?? null);

/** A hand-built "challenge" so we can break one rule at a time. */
function forged({ sequence = "-1", ops, window = 300, memo, signer = server } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b = new TransactionBuilder(new Account(server.publicKey(), sequence), {
    fee: BASE_FEE,
    networkPassphrase: NET,
    timebounds: { minTime: now, maxTime: now + window },
  });
  for (const op of ops ?? [
    Operation.manageData({ name: `${HOME} auth`, value: Buffer.alloc(48, 1).toString("base64"), source: user.publicKey() }),
    Operation.manageData({ name: "web_auth_domain", value: WEB, source: server.publicKey() }),
  ]) b.addOperation(op);
  if (memo) b.addMemo(memo);
  const tx = b.build();
  tx.sign(signer);
  return tx.toXDR();
}

test("accepts a real challenge and returns its hash", () => {
  const xdr = good();
  const c = checkChallenge(xdr, expect);
  assert.equal(c.hash, TransactionBuilder.fromXDR(xdr, NET).hash().toString("hex"));
  assert.ok(c.expiresAt > Date.now() / 1000);
});

test("the hand-built baseline is accepted, so each refusal below is for its own reason", () => {
  assert.ok(checkChallenge(forged(), expect).hash);
});

test("refuses a challenge signed by another key", () => {
  assert.throws(() => checkChallenge(good({ server: Keypair.random() }), expect), /not valid/);
  assert.throws(() => checkChallenge(forged({ signer: Keypair.random() }), expect), /not valid/);
});

test("refuses a challenge for another account", () => {
  assert.throws(() => checkChallenge(good({ account: Keypair.random().publicKey() }), expect), /different account/);
});

test("refuses a non-zero sequence number (a transaction that could run)", () => {
  assert.throws(() => checkChallenge(forged({ sequence: "41" }), expect), /not valid/);
});

test("refuses a payment hidden in the challenge", () => {
  const ops = [
    Operation.manageData({ name: `${HOME} auth`, value: Buffer.alloc(48, 1).toString("base64"), source: user.publicKey() }),
    Operation.payment({ destination: server.publicKey(), asset: Asset.native(), amount: "100", source: user.publicKey() }),
  ];
  assert.throws(() => checkChallenge(forged({ ops }), expect), /not valid|not sign-in data/);
});

test("refuses a second operation that acts as the user", () => {
  const ops = [
    Operation.manageData({ name: `${HOME} auth`, value: Buffer.alloc(48, 1).toString("base64"), source: user.publicKey() }),
    Operation.manageData({ name: "anything", value: "x", source: user.publicKey() }),
  ];
  assert.throws(() => checkChallenge(forged({ ops }), expect), /not valid/);
});

test("refuses the wrong home domain, web auth domain or network", () => {
  assert.throws(() => checkChallenge(good({ home: "evil.example" }), expect), /not valid/);
  assert.throws(() => checkChallenge(good({ web: "evil.example" }), expect), /not valid/);
  assert.throws(() => checkChallenge(good(), { ...expect, networkPassphrase: Networks.TESTNET }), /not valid/);
});

test("refuses a memo, an over-long window and an expired challenge", () => {
  assert.throws(() => checkChallenge(good({ memo: "123" }), expect), /memo/);
  assert.throws(() => checkChallenge(forged({ memo: Memo.text("x") }), expect), /not valid|memo/);
  assert.throws(() => checkChallenge(good({ timeout: 3600 }), expect), /too long/);
  assert.throws(() => checkChallenge(forged({ window: -4000 }), expect), /not valid/);
});

test("refuses contract and muxed accounts and junk input", () => {
  assert.throws(() => checkChallenge(good(), { ...expect, account: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75" }), /classic/);
  assert.throws(() => checkChallenge("not xdr", expect), /not valid/);
});

test("signChallenge attaches only the user's own signature", () => {
  const checked = checkChallenge(good(), expect);
  const hash = Buffer.from(checked.hash, "hex");
  const signed = signChallenge({ checked, networkPassphrase: NET, account: user.publicKey(), signatureHex: "0x" + user.sign(hash).toString("hex") });
  const tx = TransactionBuilder.fromXDR(signed, NET);
  assert.equal(tx.signatures.length, 2);
  // The SDK's own server-side check accepts it.
  assert.deepEqual(WebAuth.verifyChallengeTxSigners(signed, server.publicKey(), NET, [user.publicKey()], HOME, WEB), [user.publicKey()]);
  const wrong = Keypair.random().sign(hash).toString("hex");
  assert.throws(() => signChallenge({ checked, networkPassphrase: NET, account: user.publicKey(), signatureHex: wrong }), /didn't match/);
  assert.throws(() => signChallenge({ checked, networkPassphrase: NET, account: user.publicKey(), signatureHex: "abc" }), /not a wallet signature/);
});

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

test("reads the anchor token only for this account and only while valid", () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  assert.equal(readAnchorToken(jwt({ sub: user.publicKey(), exp }), user.publicKey()).expiresAt, exp);
  assert.equal(readAnchorToken(jwt({ sub: `${user.publicKey()}:7`, exp }), user.publicKey()).expiresAt, exp);
  assert.throws(() => readAnchorToken(jwt({ sub: server.publicKey(), exp }), user.publicKey()), /different account/);
  assert.throws(() => readAnchorToken(jwt({ sub: user.publicKey(), exp: 5 }), user.publicKey()), /expired/);
  assert.throws(() => readAnchorToken("garbage", user.publicKey()), /could not be read/);
});

test("exchangeChallenge posts the signed challenge and checks the reply", async () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  let sent;
  const ok = await exchangeChallenge({
    webAuthEndpoint: "https://anchor.ngnc.online/auth",
    signedXdr: "AAAA",
    account: user.publicKey(),
    fetch: async (url, init) => {
      sent = { url: String(url), method: init.method, body: JSON.parse(init.body) };
      return Response.json({ token: jwt({ sub: user.publicKey(), exp }) });
    },
  });
  assert.deepEqual(sent, { url: "https://anchor.ngnc.online/auth", method: "POST", body: { transaction: "AAAA" } });
  assert.equal(ok.expiresAt, exp);
  const args = { webAuthEndpoint: "https://anchor.ngnc.online/auth", signedXdr: "AAAA", account: user.publicKey() };
  await assert.rejects(exchangeChallenge({ ...args, fetch: async () => Response.json({}, { status: 401 }) }), /refused/);
  await assert.rejects(exchangeChallenge({ ...args, fetch: async () => Response.json({}) }), /no session token/);
});
