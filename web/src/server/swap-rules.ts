import type { Balances, Currency } from "@/lib/types";

/**
 * The pure rules for a real swap (M10). No network, so they're tested directly.
 *
 *   - minimum received: the transaction fails on chain unless at least this
 *     much arrives (the approved amount less a small allowance);
 *   - the market check: refuse a price far worse than the reference market
 *     rate, above a small size, and refuse at size when there's no market rate
 *     to compare with.
 */

export type SwapPolicy = {
  /** Allowance below the approved amount out, in basis points (50 = 0.5%). */
  slippageBps: number;
  /** Refuse when the price is more than this many percent worse than the market. */
  maxGapPct: number;
  /** Swaps up to this size (minor units of the currency sold) skip the market check. */
  checkAbove: Balances;
};

function num(v: string | undefined, fallback: number, min: number, max: number) {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Read from the environment. Out-of-range values fall back to the defaults. */
export function swapPolicy(env: Record<string, string | undefined> = process.env): SwapPolicy {
  return {
    slippageBps: Math.round(num(env.SWAP_SLIPPAGE_BPS, 50, 0, 500)),
    maxGapPct: num(env.SWAP_MAX_GAP_PCT, 3, 0, 50),
    checkAbove: {
      NGN: Math.round(num(env.SWAP_GAP_CHECK_ABOVE_NGN, 5_000, 0, 10_000_000) * 100),
      USDC: Math.round(num(env.SWAP_GAP_CHECK_ABOVE_USDC, 5, 0, 100_000) * 100),
    },
  };
}

/** The least the swap may deliver, in minor units: the approved amount less the allowance, rounded down. */
export function minReceived(amountOut: number, slippageBps: number) {
  return Math.floor((amountOut * (10_000 - slippageBps)) / 10_000);
}

/** Why a quote fails the market check, or null when it passes. */
export function marketGapProblem(
  q: { from: Currency; amountIn: number; vsMarketPct?: number },
  p: SwapPolicy,
): string | null {
  if (q.amountIn <= p.checkAbove[q.from]) return null;
  const better =
    q.from === "NGN" ? " To turn naira into dollars, the USDC cash-in on the Wallet page usually gives a better rate." : "";
  if (q.vsMarketPct === undefined) {
    return `I can't check this price against the market right now, so I won't swap this much. Try again later or swap a smaller amount.${better}`;
  }
  if (q.vsMarketPct < -p.maxGapPct) {
    return `This price is ${Math.abs(q.vsMarketPct)}% worse than the market rate, and I don't swap more than ${p.maxGapPct}% below it. Nothing was swapped.${better}`;
  }
  return null;
}

/** The fresh route still delivers at least the minimum. False means the quote is stale. */
export const stillGood = (freshOut: number, minOut: number) => freshOut >= minOut;
