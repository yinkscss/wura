import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_USDC } from "../ramp/paycrest";
import { bridgeLanded, createLifi, createMockBridge } from "./lifi";

const FROM = "G" + "A".repeat(55);
const TO = "0x" + "33".repeat(20);
const input = { fromAddress: FROM, toAddress: TO, fromAmount: "250000000", minReceiveUnits: BigInt(24_900_000) };

function quote(over: Record<string, unknown> = {}) {
  return {
    tool: "cctp",
    includedSteps: [{ type: "cross", tool: "cctp" }],
    action: { toToken: { address: BASE_USDC }, toAddress: TO, fromAmount: "250000000" },
    estimate: { toAmount: "24980000", toAmountMin: "24950000", approvalAddress: "CAPPROVE", executionDuration: 90, feeCosts: [], gasCosts: [] },
    transactionRequest: { data: "AAAA" },
    ...over,
  };
}

function client(body: unknown, status = 200, urls: string[] = []) {
  const f = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return createLifi({ fetch: f, env: {}, now: () => 1000 });
}

test("a good CCTP quote passes, and the request pins CCTP and Base USDC", async () => {
  const urls: string[] = [];
  const q = await client(quote(), 200, urls).getQuote(input);
  assert.equal(q.toAmountMinUnits, BigInt(24_950_000));
  assert.equal(q.approvalAddress, "CAPPROVE");
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("allowBridges"), "cctp");
  assert.equal(u.searchParams.get("fromChain"), "1201081091099710");
  assert.equal(u.searchParams.get("toChain"), "8453");
  assert.equal(u.searchParams.get("toToken"), BASE_USDC);
  assert.equal(q.expiresAtMs, 1000 + 4 * 60_000);
});

test("quotes that could lose or misroute money are refused", async () => {
  const cases: Array<[string, unknown]> = [
    ["other tool", quote({ tool: "layerswap" })],
    ["adds a swap", quote({ includedSteps: [{ type: "swap", tool: "soroswap" }, { type: "cross", tool: "cctp" }] })],
    ["other token", quote({ action: { toToken: { address: "0x" + "99".repeat(20) }, toAddress: TO, fromAmount: "250000000" } })],
    ["other recipient", quote({ action: { toToken: { address: BASE_USDC }, toAddress: "0x" + "44".repeat(20), fromAmount: "250000000" } })],
    ["changed amount", quote({ action: { toToken: { address: BASE_USDC }, toAddress: TO, fromAmount: "1" } })],
    ["below the floor", quote({ estimate: { toAmount: "24980000", toAmountMin: "24000000" } })],
    ["no amounts", quote({ estimate: {} })],
  ];
  for (const [name, body] of cases) {
    await assert.rejects(() => client(body).getQuote(input), `should refuse: ${name}`);
  }
});

test("bad input is refused before any call", async () => {
  let called = 0;
  const f = (async () => {
    called++;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const c = createLifi({ fetch: f, env: {} });
  await assert.rejects(() => c.getQuote({ ...input, fromAddress: "0xabc" }));
  await assert.rejects(() => c.getQuote({ ...input, toAddress: FROM }));
  await assert.rejects(() => c.getQuote({ ...input, fromAmount: "0" }));
  await assert.rejects(() => c.getQuote({ ...input, minReceiveUnits: BigInt(0) }));
  await assert.rejects(() => c.getQuote({ ...input, slippage: 0.5 }));
  assert.equal(called, 0);
});

test("status maps, and 'landed' needs done plus at least the minimum", async () => {
  const done = await client({ status: "DONE", substatus: "COMPLETED", receiving: { txHash: "0xabc", amount: "24980000" } }).getStatus({ txHash: "a".repeat(64) });
  assert.equal(done.state, "done");
  assert.equal(done.receivedUnits, BigInt(24_980_000));
  assert.equal(bridgeLanded(done, BigInt(24_900_000)), true);
  assert.equal(bridgeLanded(done, BigInt(25_000_000)), false);
  const pending = await client({ status: "PENDING" }).getStatus({ txHash: "a".repeat(64) });
  assert.equal(pending.state, "pending");
  assert.equal(bridgeLanded(pending, BigInt(1)), false);
  assert.equal((await client({ status: "FAILED" }).getStatus({ txHash: "a".repeat(64) })).state, "failed");
  await assert.rejects(() => client({}).getStatus({ txHash: "x y" }));
});

test("the mock bridge lands on demand", async () => {
  const m = createMockBridge({ now: () => 0 });
  const q = await m.getQuote(input);
  assert.ok(q.toAmountMinUnits >= input.minReceiveUnits);
  assert.equal((await m.getStatus({ txHash: "h".repeat(20) })).state, "pending");
  m.land("h".repeat(20), q.toAmountUnits);
  assert.equal(bridgeLanded(await m.getStatus({ txHash: "h".repeat(20) }), input.minReceiveUnits), true);
});
