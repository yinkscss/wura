import "server-only";
import type { Currency, UnquotedVenue, VenueId, VenueQuote } from "@/lib/types";
import { VENUE_NAMES } from "@/lib/types";
import { config } from "./config";

/**
 * Wura's own routing layer. It asks each Stellar venue for a price, compares
 * them and marks the best one. It follows StellarRoute's approach but does not
 * call a StellarRoute service (none is deployed).
 *
 * QUOTE_SOURCE=live (default): real prices, read-only, from Stellar MAINNET:
 *   - sdex:     Horizon strict-send path finding (order books + classic pools)
 *   - aquarius: Aquarius AMM find-path API
 *   - soroswap: Soroswap API, Soroswap pools only (needs SOROSWAP_API_KEY)
 * Quoting never signs anything. Executing a swap is still simulated in mock
 * mode and refused on testnet (there's no real naira asset on testnet).
 *
 * QUOTE_SOURCE=mock: fixed example prices that match the design mockups.
 *
 * Rule: if a venue can't be quoted, it is left out and reported in
 * `unquoted`. We never invent a rate for it.
 */

export type VenueAdapter = {
  id: VenueId;
  /** Amount out in minor units (cents or kobo), or throws with a short reason. */
  quote(input: { from: Currency; to: Currency; amountIn: number }): Promise<{ amountOut: number; route?: string }>;
};

// ---------- Assets (Stellar mainnet) ----------

type Classic = { code: string; issuer: string; contract: string };

/** Naira: NGNC (Link), the most-held naira asset on Stellar. Override with QUOTE_NGN_ASSET="CODE:ISSUER:CONTRACT". */
const NGN: Classic = parseAsset(process.env.QUOTE_NGN_ASSET) ?? {
  code: "NGNC",
  issuer: "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6",
  contract: "CBYFV4W2LTMXYZ3XWFX5BK2BY255DU2DSXNAE4FJ5A5VYUWGIBJDOIGG",
};
/** USDC (Circle) on mainnet. */
const USDC: Classic = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  contract: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
};

function parseAsset(v?: string): Classic | null {
  const [code, issuer, contract] = (v ?? "").split(":");
  return code && issuer && contract ? { code, issuer, contract } : null;
}

const asset = (c: Currency) => (c === "NGN" ? NGN : USDC);

/** The asset a currency is quoted in (code and issuer). Swaps check it matches the asset they execute in. */
export const quotedAsset = (c: Currency) => ({ code: asset(c).code, issuer: asset(c).issuer });

/** Our minor units (2 decimals) ↔ Stellar's 7 decimals. */
const toStroops = (minor: number) => BigInt(minor) * BigInt(100_000);
const fromStroops = (stroops: bigint) => Number(stroops / BigInt(100_000));
const toAmount = (minor: number) => (minor / 100).toFixed(7);
const fromAmount = (s: string) => Math.floor(Number(s) * 100 + 1e-6);

const MAINNET_HORIZON = process.env.QUOTE_HORIZON_URL || "https://horizon.stellar.org";
const TIMEOUT_MS = 6000;

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function fail(reason: string): never {
  throw new Error(reason);
}

// ---------- Live adapters ----------

const sdex: VenueAdapter = {
  id: "sdex",
  async quote({ from, to, amountIn }) {
    const a = asset(from), b = asset(to);
    const url =
      `${MAINNET_HORIZON}/paths/strict-send?source_asset_type=credit_alphanum4` +
      `&source_asset_code=${a.code}&source_asset_issuer=${a.issuer}&source_amount=${toAmount(amountIn)}` +
      `&destination_assets=${b.code}:${b.issuer}`;
    const { ok, body } = await getJson(url);
    if (!ok) fail("Horizon didn't answer");
    type Rec = { destination_amount: string; path: Array<{ asset_type: string; asset_code?: string }> };
    const recs: Rec[] = body?._embedded?.records ?? [];
    if (!recs.length) fail("No path found");
    const best = recs.reduce((x, y) => (Number(y.destination_amount) > Number(x.destination_amount) ? y : x));
    const hops = best.path.map((p) => (p.asset_type === "native" ? "XLM" : p.asset_code));
    return { amountOut: fromAmount(best.destination_amount), route: hops.length ? `via ${hops.join(" → ")}` : "direct" };
  },
};

const aquarius: VenueAdapter = {
  id: "aquarius",
  async quote({ from, to, amountIn }) {
    const { ok, body } = await getJson("https://amm-api.aqua.network/api/external/v1/find-path/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token_in_address: asset(from).contract,
        token_out_address: asset(to).contract,
        amount: toStroops(amountIn).toString(),
      }),
    });
    if (!ok) fail("Aquarius didn't answer");
    if (!body?.success || !body.amount) fail("No route found");
    const pools = Array.isArray(body.pools) ? body.pools.length : 0;
    return { amountOut: fromStroops(BigInt(body.amount)), route: `${pools} pool${pools === 1 ? "" : "s"}` };
  },
};

const soroswap: VenueAdapter = {
  id: "soroswap",
  async quote({ from, to, amountIn }) {
    const key = process.env.SOROSWAP_API_KEY;
    if (!key) fail("Not connected yet (needs an API key)");
    const { ok, status, body } = await getJson("https://api.soroswap.finance/quote?network=mainnet", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        assetIn: asset(from).contract,
        assetOut: asset(to).contract,
        amount: toStroops(amountIn).toString(),
        tradeType: "EXACT_IN",
        protocols: ["soroswap"],
        slippageBps: 50,
      }),
    });
    if (status === 401 || status === 403) fail("API key was refused");
    if (status === 429) fail("Rate limited, try again in a second");
    const why = [body?.title, body?.detail, body?.message].filter((x) => typeof x === "string").join(" ");
    if (!ok) {
      if (/no path|no route/i.test(why)) fail("No route in Soroswap pools");
      fail(status >= 500 ? "Soroswap's routing is down right now" : "Soroswap didn't answer");
    }
    const out = body?.amountOut;
    if (out === undefined || out === null) fail("No route found");
    const hops = Array.isArray(body?.routePlan?.[0]?.swapInfo?.path) ? body.routePlan[0].swapInfo.path.length - 1 : undefined;
    return { amountOut: fromStroops(BigInt(String(out))), route: hops ? `${hops} hop${hops === 1 ? "" : "s"}` : undefined };
  },
};

// ---------- Example adapters (QUOTE_SOURCE=mock) ----------

// NGN per 1 USDC. Chosen to match the mockups:
// ₦50,000 → 31.20 / 31.11 / 31.05 USDC, and 20 USDC → ₦31,980 on SDEX.
const EXAMPLE_BUY_RATE: Record<VenueId, number> = { aquarius: 1602.56, soroswap: 1607.2, sdex: 1610.3 };
const EXAMPLE_SELL_RATE: Record<VenueId, number> = { sdex: 1599.0, aquarius: 1595.4, soroswap: 1592.1 };

function exampleAdapter(id: VenueId): VenueAdapter {
  return {
    id,
    async quote({ from, to, amountIn }) {
      if (config.mockUnavailableVenues.includes(id)) fail("Venue did not respond");
      if (from === "NGN" && to === "USDC") return { amountOut: Math.floor(amountIn / EXAMPLE_BUY_RATE[id]) };
      if (from === "USDC" && to === "NGN") return { amountOut: Math.floor(amountIn * EXAMPLE_SELL_RATE[id]) };
      fail("Pair not supported");
    },
  };
}

export const quoteSource: "live" | "example" = process.env.QUOTE_SOURCE === "mock" ? "example" : "live";

const venues: VenueAdapter[] =
  quoteSource === "live" ? [sdex, soroswap, aquarius] : [exampleAdapter("sdex"), exampleAdapter("soroswap"), exampleAdapter("aquarius")];

/** Fee already inside the example rates: 0.25% of the amount in. Live venue fees are inside their quotes. */
export const EXAMPLE_FEE_BPS = 25;

// Short cache so repeated questions don't hammer venues (Soroswap free tier is 1 req/s).
const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof compareUncached>> }>();
const CACHE_MS = 10_000;

export async function compareVenues(input: { from: Currency; to: Currency; amountIn: number }) {
  const key = `${quoteSource}:${input.from}>${input.to}:${input.amountIn}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await compareUncached(input);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function compareUncached(input: { from: Currency; to: Currency; amountIn: number }) {
  const settled = await Promise.allSettled(venues.map((v) => v.quote(input)));
  const quoted: VenueQuote[] = [];
  const unquoted: UnquotedVenue[] = [];
  settled.forEach((r, i) => {
    const id = venues[i].id;
    if (r.status === "fulfilled" && r.value.amountOut > 0) {
      const out = r.value.amountOut;
      // rate expressed as NGN per USDC either way
      const rate = input.from === "NGN" ? input.amountIn / out : out / input.amountIn;
      quoted.push({ venue: id, name: VENUE_NAMES[id], amountOut: out, rate, best: false, route: r.value.route });
    } else {
      const reason =
        r.status === "rejected"
          ? (r.reason as Error)?.name === "TimeoutError"
            ? "Didn't answer in time"
            : String((r.reason as Error)?.message || "No quote")
          : "No quote";
      unquoted.push({ venue: id, name: VENUE_NAMES[id], reason });
    }
  });
  quoted.sort((a, b) => b.amountOut - a.amountOut);
  if (quoted[0]) quoted[0].best = true;
  return { quoted, unquoted };
}

// ---------- Market reference rate ----------

let market: { at: number; value: { rate: number; source: string; updatedAt: string } | null } | null = null;

/**
 * Reference USD→NGN rate, to warn when a Stellar venue prices far below the
 * market. From ExchangeRate-API's free endpoint (open.er-api.com), cached for
 * an hour. Returns null if unavailable; quotes still work without it.
 */
export async function marketRate() {
  if (market && Date.now() - market.at < 60 * 60 * 1000) return market.value;
  try {
    const { ok, body } = await getJson("https://open.er-api.com/v6/latest/USD");
    const rate = ok && body?.result === "success" ? Number(body.rates?.NGN) : NaN;
    market = {
      at: Date.now(),
      value: Number.isFinite(rate) && rate > 0 ? { rate, source: "ExchangeRate-API", updatedAt: String(body.time_last_update_utc ?? "") } : null,
    };
  } catch {
    market = { at: Date.now(), value: null };
  }
  return market.value;
}
