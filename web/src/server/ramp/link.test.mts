import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";

process.env.RAMP_PROVIDER = "link";

const { ApiFailure } = await import("../errors");
const { cashOutPayment, cashOutStatus, finishPartnerSignIn, rampInfo, startCashOut, startTopUp, topUpStatus } = await import("./index");
const { LINK } = await import("./link");
const LINK_PIN = LINK.USDC.pin;
const LINK_ASSET = LINK.USDC.asset;
const R = "USDC" as const;

const user = Keypair.random();
const s = { userId: "u1", email: "a@example.com", address: user.publicKey() };
const HOST = "https://anchor.linkio.world";
const TOML = `NETWORK_PASSPHRASE="${Networks.PUBLIC}"
SIGNING_KEY="${LINK_PIN.signingKey}"
WEB_AUTH_ENDPOINT="${HOST}/auth"
TRANSFER_SERVER_SEP0024="${HOST}/sep24"
`;
const INFO = {
  deposit: { USDC: { enabled: true, min_amount: 10, max_amount: 100000 } },
  withdraw: { USDC: { enabled: true, min_amount: 10, max_amount: 100000 } },
  fee: { enabled: true },
};
const NAIRA_TOML = `NETWORK_PASSPHRASE="${Networks.PUBLIC}"
SIGNING_KEY="${LINK.NGN.pin.signingKey}"
WEB_AUTH_ENDPOINT="https://anchor.ngnc.online/auth"
TRANSFER_SERVER_SEP0024="https://anchor.ngnc.online/sep24"
`;
const NAIRA_INFO = {
  deposit: { NGNC: { enabled: true, min_amount: 20000, max_amount: 20000000 } },
  withdraw: { NGNC: { enabled: true, min_amount: 10000, max_amount: 5000000 } },
  fee: { enabled: true },
};
const jwt = (sub: string, exp = Math.floor(Date.now() / 1000) + 600) =>
  `h.${Buffer.from(JSON.stringify({ sub, exp })).toString("base64url")}.s`;
/** A real, well-formed challenge for this user, but signed by a key that is not the pinned one. */
const forgedChallenge = () =>
  WebAuth.buildChallengeTx(Keypair.random(), user.publicKey(), LINK_PIN.homeDomain, 300, Networks.PUBLIC, LINK_PIN.homeDomain);

type Reply = (url: URL, init?: RequestInit) => Response | undefined;
const realFetch = globalThis.fetch;
const calls: string[] = [];

/** Stands in for the partner and mainnet Horizon. Anything not listed fails the test. */
function world(opts: { account?: "ready" | "no_dollars" | "missing" | "naira"; balance?: string; extra?: Reply } = {}) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    const extra = opts.extra?.(url, init);
    if (extra) return extra;
    if (url.href === `${HOST}/.well-known/stellar.toml`) return new Response(TOML);
    if (url.href === `${HOST}/sep24/info`) return Response.json(INFO);
    if (url.href === "https://ngnc.online/.well-known/stellar.toml") return new Response(NAIRA_TOML);
    if (url.href === "https://anchor.ngnc.online/sep24/info") return Response.json(NAIRA_INFO);
    if (url.origin === "https://horizon.stellar.org") {
      if (opts.account === "missing") return Response.json({}, { status: 404 });
      const balances = [{ asset_type: "native" }];
      const held = opts.account === "no_dollars" ? null : opts.account === "naira" ? LINK.NGN.asset : LINK_ASSET;
      if (held) balances.push({ asset_type: "credit_alphanum4", asset_code: held.code, asset_issuer: held.issuer, balance: opts.balance ?? "0.0000000" } as never);
      return Response.json({ balances });
    }
    if (url.href.startsWith(`${HOST}/auth?`)) return Response.json({ transaction: forgedChallenge() });
    throw new Error(`unexpected request: ${url.href}`);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const fails = (code: string, message: RegExp) => (err: unknown) => {
  assert.ok(err instanceof ApiFailure, `expected an ApiFailure, got ${err}`);
  assert.equal(err.code, code);
  assert.match(err.message, message);
  return true;
};

test("info offers both choices, naira first, with the trial caps applied", async () => {
  world();
  const naira = { currency: "NGN", topUp: { enabled: true, min: 20_000_00, max: 50_000_00 }, cashOut: { enabled: true, min: 10_000_00, max: 75_000_00 } };
  const dollars = { currency: "USDC", topUp: { enabled: true, min: 10_00, max: 30_00 }, cashOut: { enabled: true, min: 10_00, max: 50_00 } };
  assert.deepEqual(await rampInfo(), { provider: "link", live: true, identityCheck: "partner_page", limits: naira, options: [naira, dollars] });
});

test("keeping it as naira uses the naira service, its own limits and its own token", async () => {
  world();
  await assert.rejects(startTopUp(s, { amount: 19_999_00, receive: "NGN" }), fails("BAD_REQUEST", /smallest naira top-up is ₦20,000/));
  await assert.rejects(startTopUp(s, { amount: 50_001_00, receive: "NGN" }), fails("TRIAL_LIMIT", /capped at ₦50,000/));
  // The wallet holds dollars but no naira token, so a naira top-up is refused.
  await assert.rejects(startTopUp(s, { amount: 20_000_00, receive: "NGN", partnerToken: jwt(s.address) }), fails("SIGNING_UNAVAILABLE", /one-time setup before it can hold naira/));
  let body: Record<string, unknown> | undefined;
  world({
    account: "naira",
    extra: (url, init) => {
      if (url.href !== "https://anchor.ngnc.online/sep24/transactions/deposit/interactive") return undefined;
      body = JSON.parse(String(init?.body));
      return Response.json({ type: "interactive_customer_info_needed", id: "n-1", url: "https://anchor.ngnc.online/sep24/webapp?id=n-1" });
    },
  });
  const order = await startTopUp(s, { amount: 20_000_00, receive: "NGN", partnerToken: jwt(s.address) });
  assert.deepEqual(order, { id: "n-1", amount: 20_000_00, currency: "NGN", status: "open_partner_page", mock: false, url: "https://anchor.ngnc.online/sep24/webapp?id=n-1" });
  assert.deepEqual(body, { asset_code: "NGNC", asset_issuer: LINK.NGN.asset.issuer, account: s.address, amount: "20000.00", lang: "en" });
  assert.ok(!calls.some((c) => c.includes("linkio.world/sep24/transactions")));
});

test("amounts outside the limits are refused in plain words, before the partner is asked anything", async () => {
  world();
  await assert.rejects(startTopUp(s, { amount: 9_99, receive: R }), fails("BAD_REQUEST", /smallest naira top-up is \$10\.00/));
  await assert.rejects(startTopUp(s, { amount: 30_01, receive: R }), fails("TRIAL_LIMIT", /capped at \$30\.00/));
  assert.ok(!calls.some((c) => c.includes("horizon") || c.includes("/auth") || c.includes("/transactions")));
});

test("a wallet that can't receive dollars on the live network is refused before any sign-in", async () => {
  for (const account of ["missing", "no_dollars"] as const) {
    world({ account });
    await assert.rejects(startTopUp(s, { amount: 10_00, receive: R, partnerToken: jwt(s.address) }), fails("SIGNING_UNAVAILABLE", /one-time setup before it can hold dollars/));
    assert.ok(!calls.some((c) => c.includes("/auth") || c.includes("/transactions")));
  }
});

test("a challenge not signed by the pinned partner key never reaches the wallet", async () => {
  world();
  await assert.rejects(startTopUp(s, { amount: 10_00, receive: R }), fails("BAD_REQUEST", /can't be reached/));
});

test("a partner session for another wallet, or an expired one, is not used", async () => {
  for (const token of [jwt(Keypair.random().publicKey()), jwt(s.address, 5)]) {
    world();
    // Falls back to a fresh sign-in (which the forged challenge then fails), and never starts a top-up with it.
    await assert.rejects(startTopUp(s, { amount: 10_00, receive: R, partnerToken: token }), fails("BAD_REQUEST", /can't be reached/));
    assert.ok(!calls.some((c) => c.includes("/transactions")));
  }
});

test("with a valid partner session a top-up returns the partner's page", async () => {
  let sent: { auth: string; body: Record<string, unknown> } | undefined;
  world({
    extra: (url, init) => {
      if (url.href !== `${HOST}/sep24/transactions/deposit/interactive`) return undefined;
      sent = { auth: (init?.headers as Record<string, string>).Authorization, body: JSON.parse(String(init?.body)) };
      return Response.json({ type: "interactive_customer_info_needed", id: "tx-1", url: `${HOST}/sep24/webapp/deposit?id=tx-1` });
    },
  });
  const token = jwt(s.address);
  assert.deepEqual(await startTopUp(s, { amount: 12_50, receive: R, partnerToken: token }), {
    id: "tx-1",
    amount: 12_50,
    currency: "USDC",
    status: "open_partner_page",
    mock: false,
    url: `${HOST}/sep24/webapp/deposit?id=tx-1`,
  });
  assert.equal(sent?.auth, `Bearer ${token}`);
  assert.deepEqual(sent?.body, { asset_code: "USDC", asset_issuer: LINK_ASSET.issuer, account: s.address, amount: "12.50", lang: "en" });
});

test("a partner page off the partner's domain is refused", async () => {
  world({
    extra: (url) =>
      url.pathname.endsWith("/interactive")
        ? Response.json({ type: "interactive_customer_info_needed", id: "tx-1", url: "https://evil.example/pay" })
        : undefined,
  });
  await assert.rejects(startTopUp(s, { amount: 10_00, receive: R, partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /can't be reached/));
});

test("finishing a sign-in re-checks the challenge and never forwards a bad one", async () => {
  world();
  const sig = user.sign(Buffer.alloc(32)).toString("hex");
  await assert.rejects(finishPartnerSignIn(s, { receive: R, challenge: forgedChallenge(), signature: sig }), fails("NOT_APPROVED", /couldn't be confirmed/));
  await assert.rejects(finishPartnerSignIn(s, { receive: R, challenge: "garbage", signature: sig }), fails("NOT_APPROVED", /couldn't be confirmed/));
  assert.ok(!calls.some((c) => c.startsWith("POST")));
});

test("status reads a top-up in plain states, and only top-ups", async () => {
  const reply = (t: Record<string, unknown>) => ({
    extra: ((url) => (url.pathname === "/sep24/transaction" ? Response.json({ transaction: { id: "tx-1", ...t } }) : undefined)) as Reply,
  });
  world(reply({ kind: "deposit", status: "completed", amount_out: "12.10", amount_fee: "0.40", stellar_transaction_id: "abc" }));
  assert.deepEqual(await topUpStatus(s, { id: "tx-1", receive: R, partnerToken: jwt(s.address) }), {
    id: "tx-1",
    state: "done",
    message: "Done. The money is in your wallet.",
    currency: "USDC",
    received: 12_10,
    fee: 40,
    txRef: "abc",
  });
  world(reply({ kind: "withdrawal", status: "completed" }));
  await assert.rejects(topUpStatus(s, { id: "tx-1", receive: R, partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /can't be reached/));
  await assert.rejects(topUpStatus(s, { id: "../x", receive: R, partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /wasn't found/));
});

const withdrawal = (t: Record<string, unknown>): Reply => (url) =>
  url.pathname === "/sep24/transaction" ? Response.json({ transaction: { id: "w-1", kind: "withdrawal", ...t } }) : undefined;
const PARTNER_ACCOUNT = Keypair.random().publicKey();
const ready = { status: "pending_user_transfer_start", amount_in: "25.00", amount_fee: "0.50", withdraw_anchor_account: PARTNER_ACCOUNT, withdraw_memo: "774411", withdraw_memo_type: "id" };

test("a cash-out is checked against the limits and the wallet's real balance before the partner is asked", async () => {
  world({ balance: "24.9999999" });
  await assert.rejects(startCashOut(s, { amount: 9_99, from: R }), fails("BAD_REQUEST", /smallest cash-out is \$10\.00/));
  await assert.rejects(startCashOut(s, { amount: 50_01, from: R }), fails("TRIAL_LIMIT", /capped at \$50\.00/));
  await assert.rejects(startCashOut(s, { amount: 25_00, from: R, partnerToken: jwt(s.address) }), fails("INSUFFICIENT_BALANCE", /don't have enough/));
  world({ account: "missing" });
  await assert.rejects(startCashOut(s, { amount: 25_00, from: R, partnerToken: jwt(s.address) }), fails("SIGNING_UNAVAILABLE", /one-time setup before it can hold dollars/));
  assert.ok(!calls.some((c) => c.includes("/auth") || c.includes("/transactions")));
});

test("a cash-out opens the partner's page, where the bank account is entered", async () => {
  let body: Record<string, unknown> | undefined;
  world({
    balance: "25.0000000",
    extra: (url, init) => {
      if (url.href !== `${HOST}/sep24/transactions/withdraw/interactive`) return undefined;
      body = JSON.parse(String(init?.body));
      return Response.json({ type: "interactive_customer_info_needed", id: "w-1", url: `${HOST}/sep24/transactions/withdraw/webapp?id=w-1` });
    },
  });
  assert.deepEqual(await startCashOut(s, { amount: 25_00, from: R, partnerToken: jwt(s.address) }), {
    id: "w-1",
    amount: 25_00,
    currency: "USDC",
    status: "open_partner_page",
    mock: false,
    url: `${HOST}/sep24/transactions/withdraw/webapp?id=w-1`,
  });
  assert.deepEqual(body, { asset_code: "USDC", asset_issuer: LINK_ASSET.issuer, account: s.address, amount: "25.00", lang: "en" });
});

test("cash-out status says when the partner is ready to be paid, without handing the screen the payment", async () => {
  world({ extra: withdrawal({ status: "incomplete" }) });
  const token = jwt(s.address);
  assert.deepEqual(await cashOutStatus(s, { id: "w-1", from: R, partnerToken: token }), {
    id: "w-1", state: "waiting_for_you", message: "Enter your bank account on the partner's page to continue. Nothing has left your wallet.", currency: "USDC", send: null, fee: null, readyToPay: false, txRef: null,
  });
  assert.equal(await cashOutPayment(s, { id: "w-1", from: R, partnerToken: token }), null);
  world({ extra: withdrawal(ready) });
  const st = await cashOutStatus(s, { id: "w-1", from: R, partnerToken: token });
  assert.deepEqual(st, { id: "w-1", state: "waiting_for_you", message: "The partner is ready. Approve the payment from your wallet to finish the cash-out.", currency: "USDC", send: 25_00, fee: 50, readyToPay: true, txRef: null });
  assert.ok(!JSON.stringify(st).includes(PARTNER_ACCOUNT));
  // A top-up id is not a cash-out.
  world({ extra: (url) => (url.pathname === "/sep24/transaction" ? Response.json({ transaction: { id: "w-1", kind: "deposit", status: "completed" } }) : undefined) });
  await assert.rejects(cashOutStatus(s, { id: "w-1", from: R, partnerToken: token }), fails("BAD_REQUEST", /can't be reached/));
});

test("the payment handed to the money code is exact, and odd-looking ones are refused", async () => {
  const token = jwt(s.address);
  world({ extra: withdrawal(ready) });
  assert.deepEqual(await cashOutPayment(s, { id: "w-1", from: R, partnerToken: token }), {
    id: "w-1",
    network: "mainnet",
    currency: "USDC",
    asset: LINK_ASSET,
    amount: 25_00,
    destination: PARTNER_ACCOUNT,
    memo: "774411",
    memoType: "id",
  });
  // No partner session, or one for someone else: nothing to pay.
  assert.equal(await cashOutPayment(s, { id: "w-1", from: R }), null);
  assert.equal(await cashOutPayment(s, { id: "w-1", from: R, partnerToken: jwt(Keypair.random().publicKey()) }), null);
  for (const bad of [
    { withdraw_anchor_account: s.address }, // pays the user's own wallet
    { withdraw_anchor_account: "not-an-address" },
    { amount_in: "0" },
    { amount_in: "100001.00" }, // above the partner's own limit
    { amount_in: "9.00" }, // below it
    { withdraw_memo: "" },
  ]) {
    world({ extra: withdrawal({ ...ready, ...bad }) });
    await assert.rejects(cashOutPayment(s, { id: "w-1", from: R, partnerToken: token }), fails("BAD_REQUEST", /can't be reached/), JSON.stringify(bad));
  }
});
