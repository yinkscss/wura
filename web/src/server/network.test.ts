import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CIRCLE_MAINNET_USDC_ISSUER,
  CIRCLE_TESTNET_USDC_ISSUER,
  assertBootSafe,
  bootProblems,
  killSwitchOn,
  networkFor,
  parseMoneyMode,
} from "./network";

const SECRET = "x".repeat(40);
const mainnet = (extra: Record<string, string> = {}) => ({ MONEY_MODE: "mainnet", SESSION_SECRET: SECRET, ...extra });

test("the mainnet USDC issuer is pinned to Circle's address", () => {
  assert.equal(CIRCLE_MAINNET_USDC_ISSUER, "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  assert.equal(networkFor("mainnet", {}).usdcIssuer, CIRCLE_MAINNET_USDC_ISSUER);
  assert.equal(networkFor("testnet", {}).usdcIssuer, CIRCLE_TESTNET_USDC_ISSUER);
});

test("switching the mode changes the passphrase, Horizon, explorer, issuer and faucet", () => {
  const t = networkFor("testnet", {});
  const m = networkFor("mainnet", {});
  assert.equal(m.passphrase, "Public Global Stellar Network ; September 2015");
  assert.equal(t.passphrase, "Test SDF Network ; September 2015");
  assert.equal(m.horizonUrl, "https://horizon.stellar.org");
  assert.match(t.horizonUrl, /testnet/);
  assert.match(m.explorerBase, /\/public$/);
  assert.match(t.explorerBase, /\/testnet$/);
  assert.equal(m.friendbotUrl, "");
  assert.ok(t.friendbotUrl);
  assert.notEqual(m.usdcIssuer, t.usdcIssuer);
});

test("mode parsing: empty is mock, unknown values stop the boot", () => {
  assert.equal(parseMoneyMode({}), "mock");
  assert.equal(parseMoneyMode({ MONEY_MODE: "Mainnet" }), "mainnet");
  assert.throws(() => parseMoneyMode({ MONEY_MODE: "mainet" }), /must be mock, testnet or mainnet/);
});

test("mock and testnet setups boot", () => {
  assert.deepEqual(bootProblems({}), []);
  assert.deepEqual(bootProblems({ MONEY_MODE: "testnet", TESTNET_SIGNER: "server-dev", AGENT_KEY_SECRET: SECRET }), []);
  assert.deepEqual(bootProblems({ MONEY_MODE: "mock", VERCEL_ENV: "preview" }), []);
});

test("a clean mainnet setup boots", () => {
  assert.deepEqual(bootProblems(mainnet({ VERCEL_ENV: "production" })), []);
  assert.doesNotThrow(() => assertBootSafe(mainnet()));
});

test("mainnet refuses the testnet USDC issuer", () => {
  const p = bootProblems(mainnet({ STELLAR_USDC_ISSUER: CIRCLE_TESTNET_USDC_ISSUER }));
  assert.match(p.join(), /mainnet issuer/);
});

test("testnet refuses the mainnet USDC issuer", () => {
  const p = bootProblems({ MONEY_MODE: "testnet", STELLAR_USDC_ISSUER: CIRCLE_MAINNET_USDC_ISSUER });
  assert.match(p.join(), /mainnet USDC issuer/);
});

test("mainnet refuses a testnet Horizon", () => {
  assert.match(bootProblems(mainnet({ STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org" })).join(), /HORIZON_URL/);
});

test("mainnet refuses TESTNET_SIGNER=server-dev", () => {
  assert.throws(() => assertBootSafe(mainnet({ TESTNET_SIGNER: "server-dev" })), /server-dev/);
});

test("mainnet refuses a Preview deployment", () => {
  assert.throws(() => assertBootSafe(mainnet({ VERCEL_ENV: "preview" })), /Preview/);
});

test("mainnet refuses chat approvals until the D2 conditions are built", () => {
  assert.throws(() => assertBootSafe(mainnet({ AGENT_KEY_SECRET: SECRET })), /D2/);
});

test("mainnet needs a real SESSION_SECRET", () => {
  assert.throws(() => assertBootSafe({ MONEY_MODE: "mainnet", SESSION_SECRET: "short" }), /SESSION_SECRET/);
});

test("mainnet refuses TESTNET_CONTACTS", () => {
  assert.throws(() => assertBootSafe(mainnet({ TESTNET_CONTACTS: "Tunde:GAAAA" })), /TESTNET_CONTACTS/);
});

test("every problem is reported at once", () => {
  const p = bootProblems(mainnet({ VERCEL_ENV: "preview", TESTNET_SIGNER: "server-dev", AGENT_KEY_SECRET: SECRET }));
  assert.equal(p.length, 3);
});

test("kill switch values", () => {
  for (const v of ["1", "true", "TRUE", "on", "yes"]) assert.equal(killSwitchOn({ MONEY_KILL: v }), true, v);
  for (const v of ["", "0", "false", undefined]) assert.equal(killSwitchOn({ MONEY_KILL: v }), false, String(v));
});
