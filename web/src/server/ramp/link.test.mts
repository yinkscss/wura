import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";

process.env.RAMP_PROVIDER = "link";

const { ApiFailure } = await import("../errors");
const { finishPartnerSignIn, rampInfo, startTopUp, topUpStatus } = await import("./index");
const { LINK_ASSET, LINK_PIN } = await import("./link");

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
const jwt = (sub: string, exp = Math.floor(Date.now() / 1000) + 600) =>
  `h.${Buffer.from(JSON.stringify({ sub, exp })).toString("base64url")}.s`;
/** A real, well-formed challenge for this user, but signed by a key that is not the pinned one. */
const forgedChallenge = () =>
  WebAuth.buildChallengeTx(Keypair.random(), user.publicKey(), LINK_PIN.homeDomain, 300, Networks.PUBLIC, LINK_PIN.homeDomain);

type Reply = (url: URL, init?: RequestInit) => Response | undefined;
const realFetch = globalThis.fetch;
const calls: string[] = [];

/** Stands in for the partner and mainnet Horizon. Anything not listed fails the test. */
function world(opts: { account?: "ready" | "no_dollars" | "missing"; extra?: Reply } = {}) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    const extra = opts.extra?.(url, init);
    if (extra) return extra;
    if (url.href === `${HOST}/.well-known/stellar.toml`) return new Response(TOML);
    if (url.href === `${HOST}/sep24/info`) return Response.json(INFO);
    if (url.origin === "https://horizon.stellar.org") {
      if (opts.account === "missing") return Response.json({}, { status: 404 });
      const balances = [{ asset_type: "native" }];
      if (opts.account !== "no_dollars") balances.push({ asset_type: "credit_alphanum4", ...{ asset_code: LINK_ASSET.code, asset_issuer: LINK_ASSET.issuer } } as never);
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

test("limits are in dollars, with the trial cap applied", async () => {
  world();
  assert.deepEqual(await rampInfo(), {
    provider: "link",
    live: true,
    identityCheck: "partner_page",
    limits: {
      currency: "USDC",
      topUp: { enabled: true, min: 10_00, max: 30_00 },
      cashOut: { enabled: true, min: 10_00, max: 100_000_00 },
    },
  });
});

test("amounts outside the limits are refused in plain words, before the partner is asked anything", async () => {
  world();
  await assert.rejects(startTopUp(s, { amount: 9_99 }), fails("BAD_REQUEST", /smallest top-up is \$10\.00/));
  await assert.rejects(startTopUp(s, { amount: 30_01 }), fails("TRIAL_LIMIT", /capped at \$30\.00/));
  assert.ok(!calls.some((c) => c.includes("horizon") || c.includes("/auth") || c.includes("/transactions")));
});

test("a wallet that can't receive dollars on the live network is refused before any sign-in", async () => {
  for (const account of ["missing", "no_dollars"] as const) {
    world({ account });
    await assert.rejects(startTopUp(s, { amount: 10_00, partnerToken: jwt(s.address) }), fails("SIGNING_UNAVAILABLE", /isn't set up to receive dollars/));
    assert.ok(!calls.some((c) => c.includes("/auth") || c.includes("/transactions")));
  }
});

test("a challenge not signed by the pinned partner key never reaches the wallet", async () => {
  world();
  await assert.rejects(startTopUp(s, { amount: 10_00 }), fails("BAD_REQUEST", /can't be reached/));
});

test("a partner session for another wallet, or an expired one, is not used", async () => {
  for (const token of [jwt(Keypair.random().publicKey()), jwt(s.address, 5)]) {
    world();
    // Falls back to a fresh sign-in (which the forged challenge then fails), and never starts a top-up with it.
    await assert.rejects(startTopUp(s, { amount: 10_00, partnerToken: token }), fails("BAD_REQUEST", /can't be reached/));
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
  assert.deepEqual(await startTopUp(s, { amount: 12_50, partnerToken: token }), {
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
  await assert.rejects(startTopUp(s, { amount: 10_00, partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /can't be reached/));
});

test("finishing a sign-in re-checks the challenge and never forwards a bad one", async () => {
  world();
  const sig = user.sign(Buffer.alloc(32)).toString("hex");
  await assert.rejects(finishPartnerSignIn(s, { challenge: forgedChallenge(), signature: sig }), fails("NOT_APPROVED", /couldn't be confirmed/));
  await assert.rejects(finishPartnerSignIn(s, { challenge: "garbage", signature: sig }), fails("NOT_APPROVED", /couldn't be confirmed/));
  assert.ok(!calls.some((c) => c.startsWith("POST")));
});

test("status reads a top-up in plain states, and only top-ups", async () => {
  const reply = (t: Record<string, unknown>) => ({
    extra: ((url) => (url.pathname === "/sep24/transaction" ? Response.json({ transaction: { id: "tx-1", ...t } }) : undefined)) as Reply,
  });
  world(reply({ kind: "deposit", status: "completed", amount_out: "12.10", amount_fee: "0.40", stellar_transaction_id: "abc" }));
  assert.deepEqual(await topUpStatus(s, { id: "tx-1", partnerToken: jwt(s.address) }), {
    id: "tx-1",
    state: "done",
    currency: "USDC",
    received: 12_10,
    fee: 40,
    txRef: "abc",
  });
  world(reply({ kind: "withdrawal", status: "completed" }));
  await assert.rejects(topUpStatus(s, { id: "tx-1", partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /can't be reached/));
  await assert.rejects(topUpStatus(s, { id: "../x", partnerToken: jwt(s.address) }), fails("BAD_REQUEST", /wasn't found/));
});
