import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { test } from "node:test";
import { BASE_USDC, authorizationSignature, canonicalJson, createMockPrivyEvm, createPrivyEvm, encodeTransfer, privyEvmReady } from "./privy-evm";

const WALLET = "0x" + "11".repeat(20);
const TO = "0x" + "22".repeat(20);
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const AUTH = "wallet-auth:" + privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const env = {
  NEXT_PUBLIC_PRIVY_APP_ID: "app-1",
  PRIVY_APP_SECRET: "secret-xyz",
  PRIVY_WALLET_AUTH_KEY: AUTH,
  PRIVY_BASE_SIGNER_ID: "signer-1",
};
const send = { walletId: "wallet-abc123", walletAddress: WALLET, to: TO, amountUnits: BigInt(25_620_000), idempotencyKey: "cashout-0001" };

function client(reply: unknown, status = 200, calls: Array<{ url: string; init: RequestInit }> = [], e: Record<string, string> = env) {
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return createPrivyEvm({ fetch: f, env: e });
}

test("ERC-20 calldata is the standard transfer encoding", () => {
  const d = encodeTransfer(TO, BigInt(25_620_000));
  assert.equal(d.length, 2 + 8 + 64 + 64);
  assert.ok(d.startsWith("0xa9059cbb"));
  assert.ok(d.slice(10, 74).endsWith("22".repeat(20)));
  assert.equal(BigInt("0x" + d.slice(74)), BigInt(25_620_000));
  assert.throws(() => encodeTransfer("0x12", BigInt(1)));
});

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } }), '{"a":{"d":[2,{"x":2,"y":1}]},"b":1}');
});

test("the request signature verifies with the matching public key and not after tampering", () => {
  const parts = { method: "POST", url: "https://api.privy.io/v1/wallets/w/rpc", body: { a: 1 }, appId: "app-1" };
  const sig = authorizationSignature(AUTH, parts);
  const payload = canonicalJson({ version: 1, method: "POST", url: parts.url, body: { a: 1 }, headers: { "privy-app-id": "app-1" } });
  const pub = publicKey;
  assert.equal(createVerify("sha256").update(payload).verify(pub, Buffer.from(sig, "base64")), true);
  const other = canonicalJson({ version: 1, method: "POST", url: parts.url, body: { a: 2 }, headers: { "privy-app-id": "app-1" } });
  assert.equal(createVerify("sha256").update(other).verify(pub, Buffer.from(sig, "base64")), false);
});

test("sendUsdc builds a sponsored USDC transfer, signed, with an idempotency key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const out = await client({ data: { transaction_id: "tx-12345678", hash: "" } }, 200, calls).sendUsdc(send);
  assert.equal(out.transactionId, "tx-12345678");
  assert.equal(out.hash, null);
  assert.equal(calls[0].url, "https://api.privy.io/v1/wallets/wallet-abc123/rpc");
  const h = calls[0].init.headers as Record<string, string>;
  assert.ok(h["privy-authorization-signature"]);
  assert.equal(h["privy-idempotency-key"], "cashout-0001");
  const b = JSON.parse(calls[0].init.body as string);
  assert.equal(b.caip2, "eip155:8453");
  assert.equal(b.sponsor, true);
  assert.equal(b.params.transaction.to, BASE_USDC);
  assert.equal(b.params.transaction.value, "0x0");
  assert.equal(b.params.transaction.data, encodeTransfer(TO, BigInt(25_620_000)));
});

test("USDC-gas mode adds sponsor_options; unsponsored is refused unless allowed", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  await client({ transaction_id: "tx-12345678" }, 200, calls).sendUsdc({ ...send, sponsor: "usdc" });
  assert.deepEqual(JSON.parse(calls[0].init.body as string).sponsor_options, { asset: "usdc" });
  await assert.rejects(() => client({ transaction_id: "tx-12345678" }).sendUsdc({ ...send, sponsor: "none" }));
  await client({ transaction_id: "tx-12345678" }, 200, [], { ...env, PRIVY_ALLOW_UNSPONSORED: "1" }).sendUsdc({ ...send, sponsor: "none" });
});

test("sendUsdc refuses anything that could send money the wrong way, before any call", async () => {
  let called = 0;
  const f = (async () => {
    called++;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const c = createPrivyEvm({ fetch: f, env, maxTransferUnits: BigInt(50_000_000) });
  const bad: Array<[string, Partial<typeof send>]> = [
    ["bad recipient", { to: "0xabc" }],
    ["zero address", { to: "0x" + "0".repeat(40) }],
    ["USDC contract", { to: BASE_USDC }],
    ["self", { to: WALLET }],
    ["zero amount", { amountUnits: BigInt(0) }],
    ["over the cap", { amountUnits: BigInt(50_000_001) }],
    ["bad wallet id", { walletId: "x" }],
    ["bad idempotency key", { idempotencyKey: "short" }],
  ];
  for (const [name, patch] of bad) await assert.rejects(() => c.sendUsdc({ ...send, ...patch }), `should refuse: ${name}`);
  assert.equal(called, 0);
});

test("a missing signing key stops the send, and errors never carry secrets", async () => {
  await assert.rejects(() => client({}, 200, [], { ...env, PRIVY_WALLET_AUTH_KEY: "" }).sendUsdc(send));
  const err = await client({ error: "bad things" }, 401).sendUsdc(send).then(() => null, (e: Error) => e);
  assert.match(err?.message ?? "", /bad things/);
  for (const secret of ["secret-xyz", AUTH.slice(12, 40)]) assert.ok(!(err?.message ?? "").includes(secret));
});

test("usdcBalance reads balanceOf from the chain", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const bal = await client({ jsonrpc: "2.0", id: 1, result: "0x" + (25_620_000).toString(16) }, 200, calls).usdcBalance(WALLET);
  assert.equal(bal, BigInt(25_620_000));
  assert.equal(calls[0].url, "https://mainnet.base.org");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.method, "eth_call");
  assert.equal(body.params[0].to, BASE_USDC);
  assert.ok(body.params[0].data.startsWith("0x70a08231"));
  await assert.rejects(() => client({ result: "garbage" }).usdcBalance(WALLET));
});

test("getTransfer maps statuses", async () => {
  assert.deepEqual(await client({ status: "confirmed", transaction_hash: "0xab" }).getTransfer("tx-12345678"), { state: "confirmed", hash: "0xab" });
  assert.equal((await client({ status: "failed" }).getTransfer("tx-12345678")).state, "failed");
  assert.equal((await client({ status: "weird" }).getTransfer("tx-12345678")).state, "unknown");
});

test("readiness needs all four settings", () => {
  assert.equal(privyEvmReady({}), false);
  assert.equal(privyEvmReady(env), true);
  assert.equal(privyEvmReady({ ...env, PRIVY_BASE_SIGNER_ID: "" }), false);
});

test("the mock refuses a double pay with the same key and an overdraft", async () => {
  const m = createMockPrivyEvm();
  const w = await m.createWallet("did:privy:abc");
  assert.deepEqual(await m.findWallet("did:privy:abc"), w);
  m.fund(w.address, BigInt(30_000_000));
  const a = await m.sendUsdc({ ...send, walletAddress: w.address });
  const b = await m.sendUsdc({ ...send, walletAddress: w.address });
  assert.equal(a.transactionId, b.transactionId);
  assert.equal(await m.usdcBalance(w.address), BigInt(30_000_000) - BigInt(25_620_000));
  await assert.rejects(() => m.sendUsdc({ ...send, walletAddress: w.address, idempotencyKey: "cashout-0002" }));
  m.confirm(a.transactionId!);
  assert.equal((await m.getTransfer(a.transactionId!)).state, "confirmed");
});
