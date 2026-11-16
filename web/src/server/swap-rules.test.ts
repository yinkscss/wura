import assert from "node:assert/strict";
import { test } from "node:test";
import { marketGapProblem, minReceived, stillGood, swapPolicy } from "./swap-rules";

const P = swapPolicy({});

test("defaults: 0.5% allowance, 3% market gap, checked above ₦5,000 or $5", () => {
  assert.deepEqual(P, { slippageBps: 50, maxGapPct: 3, checkAbove: { NGN: 5_000_00, USDC: 5_00 } });
});

test("settings are read, and out-of-range values fall back to the defaults", () => {
  const p = swapPolicy({ SWAP_SLIPPAGE_BPS: "100", SWAP_MAX_GAP_PCT: "2.5", SWAP_GAP_CHECK_ABOVE_NGN: "0", SWAP_GAP_CHECK_ABOVE_USDC: "1" });
  assert.deepEqual(p, { slippageBps: 100, maxGapPct: 2.5, checkAbove: { NGN: 0, USDC: 1_00 } });
  assert.equal(swapPolicy({ SWAP_SLIPPAGE_BPS: "9000" }).slippageBps, 50);
  assert.equal(swapPolicy({ SWAP_MAX_GAP_PCT: "nope" }).maxGapPct, 3);
});

test("minimum received is the approved amount less the allowance, rounded down", () => {
  assert.equal(minReceived(10_000, 50), 9_950);
  assert.equal(minReceived(3_120, 50), 3_104); // 31.20 USDC → at least 31.04
  assert.equal(minReceived(1_00, 0), 1_00);
});

test("a fresh route under the minimum is stale; at or above it is fine", () => {
  assert.equal(stillGood(9_949, 9_950), false);
  assert.equal(stillGood(9_950, 9_950), true);
  assert.equal(stillGood(12_000, 9_950), true);
});

test("small swaps skip the market check", () => {
  assert.equal(marketGapProblem({ from: "NGN", amountIn: 5_000_00, vsMarketPct: -40 }, P), null);
  assert.equal(marketGapProblem({ from: "USDC", amountIn: 5_00 }, P), null);
});

test("naira to dollars at size: refused when far below the market, pointing to the USDC cash-in", () => {
  const why = marketGapProblem({ from: "NGN", amountIn: 50_000_00, vsMarketPct: -4.2 }, P);
  assert.match(why!, /4\.2% worse/);
  assert.match(why!, /USDC cash-in/);
  assert.equal(marketGapProblem({ from: "NGN", amountIn: 50_000_00, vsMarketPct: -2.9 }, P), null);
  assert.equal(marketGapProblem({ from: "NGN", amountIn: 50_000_00, vsMarketPct: 1 }, P), null);
});

test("dollars to naira at size is checked too, without the cash-in hint", () => {
  const why = marketGapProblem({ from: "USDC", amountIn: 20_00, vsMarketPct: -10 }, P);
  assert.match(why!, /10% worse/);
  assert.doesNotMatch(why!, /cash-in/);
});

test("no market rate at size is a refusal, not a silent pass", () => {
  assert.match(marketGapProblem({ from: "NGN", amountIn: 50_000_00 }, P)!, /can't check this price/);
});
