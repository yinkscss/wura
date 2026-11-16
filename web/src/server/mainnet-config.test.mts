import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.APP_URL = "https://wura.example";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
process.env.PRIVY_APP_SECRET = "privy-secret";
process.env.DATABASE_URL = "postgres://nobody@localhost:1/none"; // never connected: these tests don't touch the database
process.env.SESSION_SECRET = "y".repeat(40);
delete process.env.VERCEL_ENV;
delete process.env.TESTNET_SIGNER;
delete process.env.AGENT_KEY_SECRET;
delete process.env.STELLAR_USDC_ISSUER;
delete process.env.STELLAR_HORIZON_URL;
const { config, moneyLive, onMainnet, serverDevSigning } = await import("./config");
const { fundWithFriendbot } = await import("./stellar");
const { chatApprovalsAvailable } = await import("./agent-key");

test("mainnet config reads its own addresses and links", () => {
  assert.equal(config.stellarNetwork, "mainnet");
  assert.equal(config.networkPassphrase, "Public Global Stellar Network ; September 2015");
  assert.equal(config.horizonUrl, "https://horizon.stellar.org");
  assert.match(config.explorerTx("abc"), /explorer\/public\/tx\/abc/);
  assert.equal(config.usdc.issuer, "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  assert.equal(config.usingCircleUsdc, true);
  assert.ok(moneyLive() && onMainnet() && !serverDevSigning());
});

test("mainnet has no faucet and no chat approvals", async () => {
  await assert.rejects(fundWithFriendbot("GAAAA"), /no test faucet/);
  assert.equal(chatApprovalsAvailable(), false);
});
