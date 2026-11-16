import assert from "node:assert/strict";
import { test } from "node:test";
import { currentKeyVersion, seal, unseal, vaultReady } from "./vault";

const KEY = "k".repeat(40);
const who = { userId: "did:privy:abc", service: "NGN" };

test("without a key, or with a short one, nothing is sealed", () => {
  assert.equal(vaultReady({}), false);
  assert.equal(seal("token", who, {}), null);
  assert.equal(seal("token", who, { RAMP_TOKEN_KEY: "short" }), null);
});

test("a sealed token opens for the same user and service, and doesn't contain the token", () => {
  const env = { RAMP_TOKEN_KEY: KEY };
  const s = seal("eyJ.partner.token", who, env);
  assert.ok(s);
  assert.equal(s.keyVersion, 1);
  assert.ok(!s.sealed.includes("partner"));
  assert.ok(!Buffer.from(s.sealed, "base64").toString("latin1").includes("partner"));
  assert.equal(unseal(s.sealed, s.keyVersion, who, env), "eyJ.partner.token");
  assert.notEqual(seal("eyJ.partner.token", who, env)?.sealed, s.sealed, "a fresh nonce every time");
});

test("it won't open for another user, another service, another key, or after a change", () => {
  const env = { RAMP_TOKEN_KEY: KEY };
  const s = seal("token", who, env)!;
  assert.equal(unseal(s.sealed, 1, { ...who, userId: "did:privy:other" }, env), null);
  assert.equal(unseal(s.sealed, 1, { ...who, service: "USDC" }, env), null);
  assert.equal(unseal(s.sealed, 1, who, { RAMP_TOKEN_KEY: "z".repeat(40) }), null);
  const raw = Buffer.from(s.sealed, "base64");
  raw[raw.length - 1] ^= 1;
  assert.equal(unseal(raw.toString("base64"), 1, who, env), null);
  assert.equal(unseal("", 1, who, env), null);
  assert.equal(unseal("not base64 !!", 1, who, env), null);
});

test("rotation: old rows open with the kept old key, new rows use the new one", () => {
  const before = { RAMP_TOKEN_KEY: KEY };
  const old = seal("token", who, before)!;
  const after = { RAMP_TOKEN_KEY: "n".repeat(40), RAMP_TOKEN_KEY_VERSION: "2", RAMP_TOKEN_KEY_V1: KEY };
  assert.equal(currentKeyVersion(after), 2);
  assert.equal(unseal(old.sealed, old.keyVersion, who, after), "token");
  const fresh = seal("token", who, after)!;
  assert.equal(fresh.keyVersion, 2);
  assert.equal(unseal(fresh.sealed, 2, who, after), "token");
  // Once the old key is removed, old rows no longer open.
  assert.equal(unseal(old.sealed, 1, who, { RAMP_TOKEN_KEY: "n".repeat(40), RAMP_TOKEN_KEY_VERSION: "2" }), null);
  assert.equal(currentKeyVersion({ RAMP_TOKEN_KEY_VERSION: "nonsense" }), 1);
});
