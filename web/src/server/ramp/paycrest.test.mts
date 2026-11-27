import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { BASE_USDC, createMockPaycrest, createPaycrest, mapStatus, parseWebhook, paycrestReady, verifyWebhookSignature } from "./paycrest";
import { formatUnits, parseUnits } from "../units";

const env = { PAYCREST_API_KEY: "key-123", PAYCREST_API_SECRET: "secret-456" };
const REFUND = "0x" + "11".repeat(20);
const DEPOSIT = "0x" + "22".repeat(20);
const NOW = 1_800_000_000_000;
const input = {
  amountUsdc: "25.5",
  refundAddress: REFUND,
  reference: "wura-1",
  recipient: { institution: "GTBINGLA", accountIdentifier: "0123456789", accountName: "Ada Obi", memo: "Wura cash-out" },
};

function order(pa: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    status: "success",
    data: {
      id: "ord-12345678",
      status: "initiated",
      reference: "wura-1",
      rate: "1500",
      providerAccount: {
        network: "base",
        currency: "USDC",
        receiveAddress: DEPOSIT,
        amountToTransfer: "25.62",
        validUntil: new Date(NOW + 10 * 60_000).toISOString(),
        ...pa,
      },
      ...extra,
    },
  };
}

function client(body: unknown, status = 200, calls: Array<{ url: string; init: RequestInit }> = []) {
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return createPaycrest({ fetch: f, env, now: () => NOW });
}

test("units are exact", () => {
  assert.equal(parseUnits("25.5", 6), BigInt(25_500_000));
  assert.equal(formatUnits(BigInt(25_620_000), 6), "25.62");
  assert.equal(formatUnits(BigInt(5), 6), "0.000005");
  assert.throws(() => parseUnits("1.1234567", 6));
  assert.throws(() => parseUnits("-1", 6));
  assert.throws(() => parseUnits("1e3", 6));
});

test("ready only with both key and secret", () => {
  assert.equal(paycrestReady({}), false);
  assert.equal(paycrestReady({ PAYCREST_API_KEY: "a" }), false);
  assert.equal(paycrestReady(env), true);
});

test("createOrder sends the right request and returns checked deposit details", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const o = await client(order(), 200, calls).createOrder(input);
  assert.equal(calls[0].url, "https://api.paycrest.io/v2/sender/orders");
  assert.equal((calls[0].init.headers as Record<string, string>)["API-Key"], "key-123");
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.source.network, "base");
  assert.equal(sent.source.currency, "USDC");
  assert.equal(sent.source.refundAddress, REFUND);
  assert.equal(sent.destination.currency, "NGN");
  assert.equal(sent.amountIn, "crypto");
  assert.equal(o.deposit.amountUnits, BigInt(25_620_000));
  assert.equal(o.deposit.receiveAddress, DEPOSIT);
  assert.equal(o.state, "awaiting_deposit");
});

test("createOrder refuses anything that could send money the wrong way", async () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["other network", { network: "ethereum" }],
    ["other token", { currency: "USDT" }],
    ["bad address", { receiveAddress: "0x123" }],
    ["our own refund address", { receiveAddress: REFUND }],
    ["memo required", { memo: "12345" }],
    ["less than asked", { amountToTransfer: "25.4" }],
    ["fees too high", { amountToTransfer: "30" }],
    ["fees above 5% of a small order", { amountToTransfer: "26.9" }],
    ["expires too soon", { validUntil: new Date(NOW + 10_000).toISOString() }],
    ["no expiry", { validUntil: undefined }],
    ["bad amount", { amountToTransfer: "abc" }],
  ];
  for (const [name, pa] of bad) {
    await assert.rejects(() => client(order(pa)).createOrder(input), `should refuse: ${name}`);
  }
});

test("createOrder refuses bad input before calling out", async () => {
  let called = 0;
  const f = (async () => {
    called++;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const c = createPaycrest({ fetch: f, env, now: () => NOW });
  await assert.rejects(() => c.createOrder({ ...input, amountUsdc: "0" }));
  await assert.rejects(() => c.createOrder({ ...input, refundAddress: "nope" }));
  await assert.rejects(() => c.createOrder({ ...input, recipient: { ...input.recipient, accountIdentifier: "123" } }));
  await assert.rejects(() => c.createOrder({ ...input, recipient: { ...input.recipient, accountName: " " } }));
  assert.equal(called, 0);
});

test("an HTTP error carries the partner's message but never the key", async () => {
  const err = await client({ status: "error", message: "Invalid API key" }, 401)
    .getOrder("ord-12345678")
    .then(() => null, (e: Error) => e);
  assert.ok(err);
  assert.match(err?.message ?? "", /Invalid API key/);
  assert.ok(!(err?.message ?? "").includes("key-123"));
});

test("verifyAccount: a name, or null when lookup isn't offered", async () => {
  assert.equal(await client({ data: "ADA OBI" }).verifyAccount("GTBINGLA", "0123456789"), "ADA OBI");
  assert.equal(await client({ data: "OK" }).verifyAccount("GTBINGLA", "0123456789"), null);
  await assert.rejects(() => client({ data: "ADA" }).verifyAccount("GTBINGLA", "12"));
});

test("sellRate reads data.sell.rate, no key sent", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const r = await client({ data: { buy: { rate: "1490" }, sell: { rate: "1510" } } }, 200, calls).sellRate("100");
  assert.equal(r, "1510");
  assert.equal(calls[0].url, "https://api.paycrest.io/v2/rates/base/USDC/100/NGN");
  assert.equal((calls[0].init.headers as Record<string, string>)["API-Key"], undefined);
});

test("status mapping", () => {
  assert.equal(mapStatus("initiated"), "awaiting_deposit");
  assert.equal(mapStatus("validated"), "paid");
  assert.equal(mapStatus("settled"), "settled");
  assert.equal(mapStatus("refunded"), "refunded");
  assert.equal(mapStatus("expired"), "expired");
  assert.equal(mapStatus("brand-new"), "unknown");
});

test("webhook signature: right secret passes, tampering and wrong secret fail", () => {
  const body = JSON.stringify({ event: "payment_order.validated", data: { status: "validated" } });
  const sig = createHmac("sha256", "secret-456").update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, sig, "secret-456"), true);
  assert.equal(verifyWebhookSignature(body, sig.toUpperCase(), "secret-456"), true);
  assert.equal(verifyWebhookSignature(body + " ", sig, "secret-456"), false);
  assert.equal(verifyWebhookSignature(body, sig, "other"), false);
  assert.equal(verifyWebhookSignature(body, "abc", "secret-456"), false);
  assert.equal(verifyWebhookSignature(body, null, "secret-456"), false);
  assert.equal(verifyWebhookSignature(body, sig, undefined), false);
});

test("parseWebhook: off-ramp order events only", () => {
  const e = parseWebhook(JSON.stringify({ event: "payment_order.validated", data: { direction: "offramp", status: "validated", id: "o1", txHash: "0xab" } }));
  assert.equal(e?.state, "paid");
  assert.equal(e?.orderId, "o1");
  assert.equal(parseWebhook(JSON.stringify({ event: "payment_order.compliance_hold", data: { status: "pending" } }))?.state, "held");
  assert.equal(parseWebhook(JSON.stringify({ event: "payment_order.settled", data: { direction: "onramp" } })), null);
  assert.equal(parseWebhook(JSON.stringify({ event: "something.else" })), null);
  assert.equal(parseWebhook("not json"), null);
});

test("the mock follows the same shapes", async () => {
  const m = createMockPaycrest({ now: () => NOW });
  const o = await m.createOrder(input);
  assert.equal(o.deposit.amountUnits, BigInt(25_600_000));
  assert.equal((await m.getOrder(o.id)).state, "awaiting_deposit");
  m.advance(o.id, "settled");
  assert.equal((await m.getOrder(o.id)).state, "settled");
  assert.equal(BASE_USDC.length, 42);
});
