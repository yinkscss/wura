import assert from "node:assert/strict";
import { test } from "node:test";
import { Networks } from "@stellar/stellar-sdk";
import { AnchorConfigError, loadAnchor, parseTomlTopLevel, validateAnchorToml } from "./sep1";

const KEY = "GCQLPBWOQ5PAJYEEQBE7GDSY7X3LCYKFEBKOCNF3OUA6F74ORK74HVSQ";
const PIN = { homeDomain: "ngnc.online", networkPassphrase: Networks.PUBLIC, signingKey: KEY };
const TOML = `NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
SIGNING_KEY="${KEY}"
WEB_AUTH_ENDPOINT="https://anchor.ngnc.online/auth"
TRANSFER_SERVER_SEP0024="https://anchor.ngnc.online/sep24"

[DOCUMENTATION]
SIGNING_KEY="GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6"
`;
const withLine = (name: string, value: string) => TOML.replace(new RegExp(`^${name}=.*$`, "m"), `${name}="${value}"`);
const check = (toml: string) => validateAnchorToml(parseTomlTopLevel(toml), PIN);

test("reads endpoints from a good config", () => {
  assert.deepEqual(check(TOML), {
    homeDomain: "ngnc.online",
    networkPassphrase: Networks.PUBLIC,
    signingKey: KEY,
    webAuthEndpoint: "https://anchor.ngnc.online/auth",
    webAuthDomain: "anchor.ngnc.online",
    transferServer: "https://anchor.ngnc.online/sep24",
  });
});

test("ignores keys inside tables and accepts single quotes", () => {
  assert.equal(parseTomlTopLevel(TOML).SIGNING_KEY, KEY);
  assert.equal(parseTomlTopLevel("A = 'x' # note\n").A, "x");
});

test("refuses a changed signing key", () => {
  const other = "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6";
  assert.throws(() => check(withLine("SIGNING_KEY", other)), /SIGNING_KEY changed/);
});

test("refuses the wrong network", () => {
  assert.throws(() => check(withLine("NETWORK_PASSPHRASE", Networks.TESTNET)), /different Stellar network/);
});

test("refuses endpoints that are not HTTPS on the anchor's domain", () => {
  assert.throws(() => check(withLine("WEB_AUTH_ENDPOINT", "http://anchor.ngnc.online/auth")), /not HTTPS/);
  assert.throws(() => check(withLine("WEB_AUTH_ENDPOINT", "https://evil.example/auth")), /not on ngnc.online/);
  assert.throws(() => check(withLine("TRANSFER_SERVER_SEP0024", "https://ngnc.online.evil.example/sep24")), /not on ngnc.online/);
  assert.throws(() => check(withLine("TRANSFER_SERVER_SEP0024", "https://user:pw@anchor.ngnc.online/sep24")), /credentials/);
  assert.throws(() => check(TOML.replace(/^WEB_AUTH_ENDPOINT=.*\n/m, "")), /no WEB_AUTH_ENDPOINT/);
});

test("loadAnchor refuses bad responses", async () => {
  const ok = await loadAnchor(PIN, { fetch: async () => new Response(TOML) });
  assert.equal(ok.signingKey, KEY);
  await assert.rejects(loadAnchor(PIN, { fetch: async () => new Response("no", { status: 404 }) }), AnchorConfigError);
  await assert.rejects(loadAnchor(PIN, { fetch: async () => new Response("x".repeat(200_000)) }), /too large/);
  await assert.rejects(loadAnchor(PIN, { fetch: async () => { throw new Error("down"); } }), /Couldn't reach/);
});
