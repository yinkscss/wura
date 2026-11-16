import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.APP_URL = "https://wura.example";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
process.env.PRIVY_APP_SECRET = "privy-secret";
process.env.DATABASE_URL = "postgres://nobody@localhost:1/none"; // never connected: these tests don't touch the database
process.env.SESSION_SECRET = "y".repeat(40);
for (const k of ["VERCEL_ENV", "TESTNET_SIGNER", "AGENT_KEY_SECRET", "STELLAR_USDC_ISSUER", "STELLAR_HORIZON_URL", "TESTNET_CONTACTS", "MONEY_KILL", "TREASURY_SECRET", "BETA_ALLOWLIST"]) delete process.env[k];
const { sponsorAllowed, sponsorshipConfigured, requiredAssets, startingXlm, assertInvited } = await import("./treasury");
const { EXAMPLE_LIMITS } = await import("./money");
const { Keypair } = await import("@stellar/stellar-sdk");

test("on mainnet an empty allowlist lets nobody in; the list is by email, case-insensitive", () => {
  assert.equal(sponsorAllowed("a@example.com"), false);
  process.env.BETA_ALLOWLIST = " A@Example.com , b@example.com ";
  assert.equal(sponsorAllowed("a@example.com"), true);
  assert.equal(sponsorAllowed("B@EXAMPLE.COM"), true);
  assert.equal(sponsorAllowed("c@example.com"), false);
});

test("on mainnet only allowlisted emails may preview a send or make a link", () => {
  const was = process.env.BETA_ALLOWLIST;
  process.env.BETA_ALLOWLIST = "a@example.com";
  assert.doesNotThrow(() => assertInvited("A@example.com"));
  assert.throws(() => assertInvited("c@example.com"), /invite-only/);
  process.env.BETA_ALLOWLIST = "";
  assert.throws(() => assertInvited("a@example.com"), /invite-only/);
  process.env.BETA_ALLOWLIST = was;
});

test("mainnet caps start at 25% of the example caps (D5)", () => {
  assert.equal(EXAMPLE_LIMITS.perPayment.NGN, 18_750_00);
  assert.equal(EXAMPLE_LIMITS.perPayment.USDC, 12_00);
  assert.equal(EXAMPLE_LIMITS.daily.NGN, 50_000_00);
  assert.equal(EXAMPLE_LIMITS.daily.USDC, 50_00);
});

test("sponsorship needs a valid TREASURY_SECRET", () => {
  assert.equal(sponsorshipConfigured(), false);
  process.env.TREASURY_SECRET = "nope";
  assert.equal(sponsorshipConfigured(), false);
  process.env.TREASURY_SECRET = Keypair.random().secret();
  assert.equal(sponsorshipConfigured(), true);
});

test("mainnet wallets need both trustlines; the fee balance defaults to 0.5 XLM", () => {
  assert.deepEqual(requiredAssets().map((r) => r.currency), ["USDC", "NGN"]);
  assert.equal(startingXlm(), "0.5");
  process.env.SPONSOR_FEE_XLM = "1";
  assert.equal(startingXlm(), "1.0");
});

const { prepareSponsoredSetup } = await import("./treasury");
const { ApiFailure } = await import("./errors");
const st = { address: "GAAAA", exists: false, xlm: "0", usdc: null, hasTrustline: false, ngn: null, hasNgncTrustline: false, memoRequired: false };

test("the kill switch stops the treasury before it touches Horizon or its key", async () => {
  // Mainnet mode here, so the kill switch applies (it applies to any live mode).
  process.env.BETA_ALLOWLIST = "a@example.com";
  process.env.MONEY_KILL = "1";
  await assert.rejects(
    prepareSponsoredSetup({ userId: "u", email: "a@example.com", address: "GAAAA" }, st),
    (e: unknown) => e instanceof ApiFailure && e.code === "MONEY_PAUSED",
  );
  delete process.env.MONEY_KILL;
});

test("a user who isn't on the allowlist is refused before anything is built", async () => {
  await assert.rejects(
    prepareSponsoredSetup({ userId: "u", email: "nobody@example.com", address: "GAAAA" }, st),
    (e: unknown) => e instanceof ApiFailure && e.code === "NOT_INVITED",
  );
});
