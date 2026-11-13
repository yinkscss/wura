import "server-only";
import type { Currency, UnquotedVenue, VenueId, VenueQuote } from "@/lib/types";
import { VENUE_NAMES } from "@/lib/types";
import { config } from "./config";

/**
 * Wura's own routing layer. It asks each Stellar venue for a price,
 * compares them and marks the best one. It follows StellarRoute's approach but
 * does not call a StellarRoute service (none is deployed).
 *
 * v1 uses fixed example prices so every screen works without keys. Each venue
 * is an adapter, so the mock can be replaced one venue at a time:
 *   - sdex:     Horizon strict-send path finding
 *   - soroswap: Soroswap router / quote API
 *   - aquarius: Aquarius AMM routing API
 *
 * Open question (docs/open-questions.md): which NGN asset on Stellar these
 * venues quote against.
 *
 * Rule: if a venue cannot be quoted, it is left out and reported in
 * `unquoted`. We never invent a rate for it.
 */

export type VenueAdapter = {
  id: VenueId;
  /** Returns amount out in minor units, or throws if the venue cannot be quoted. */
  quote(input: { from: Currency; to: Currency; amountIn: number }): Promise<number>;
};

// Example all-in prices (NGN per 1 USDC). Buying USDC: lower is better.
// Selling USDC: higher is better. Chosen to match the mockups:
// ₦50,000 → 31.20 / 31.11 / 31.05 USDC, and 20 USDC → ₦31,980 on SDEX.
const EXAMPLE_BUY_RATE: Record<VenueId, number> = {
  aquarius: 1602.56,
  soroswap: 1607.2,
  sdex: 1610.3,
};
const EXAMPLE_SELL_RATE: Record<VenueId, number> = {
  sdex: 1599.0,
  aquarius: 1595.4,
  soroswap: 1592.1,
};

function mockAdapter(id: VenueId): VenueAdapter {
  return {
    id,
    async quote({ from, to, amountIn }) {
      if (config.mockUnavailableVenues.includes(id)) {
        throw new Error("Venue did not respond");
      }
      if (from === "NGN" && to === "USDC") {
        // amountIn kobo → USDC cents, rounded down
        return Math.floor(amountIn / EXAMPLE_BUY_RATE[id]);
      }
      if (from === "USDC" && to === "NGN") {
        return Math.floor(amountIn * EXAMPLE_SELL_RATE[id]);
      }
      throw new Error("Pair not supported");
    },
  };
}

export const venues: VenueAdapter[] = [mockAdapter("sdex"), mockAdapter("soroswap"), mockAdapter("aquarius")];

/** Fee already inside the example rates: 0.25% of the amount in. */
export const EXAMPLE_FEE_BPS = 25;

export async function compareVenues(input: { from: Currency; to: Currency; amountIn: number }) {
  const settled = await Promise.allSettled(venues.map((v) => v.quote(input)));
  const quoted: VenueQuote[] = [];
  const unquoted: UnquotedVenue[] = [];
  settled.forEach((r, i) => {
    const id = venues[i].id;
    if (r.status === "fulfilled" && r.value > 0) {
      const out = r.value;
      // rate expressed as NGN per USDC either way
      const rate =
        input.from === "NGN" ? input.amountIn / out : out / input.amountIn;
      quoted.push({ venue: id, name: VENUE_NAMES[id], amountOut: out, rate, best: false });
    } else {
      unquoted.push({
        venue: id,
        name: VENUE_NAMES[id],
        reason: r.status === "rejected" ? String((r.reason as Error)?.message || "No quote") : "No quote",
      });
    }
  });
  quoted.sort((a, b) => b.amountOut - a.amountOut);
  if (quoted[0]) quoted[0].best = true;
  return { quoted, unquoted };
}
