import "server-only";
import type { Quote } from "@/lib/types";
import { money } from "@/lib/format";
import { config, moneyLive, onMainnet } from "./config";
import { ApiFailure } from "./errors";
import { checkLimits, log } from "./money";
import { quotedAsset } from "./routing";
import type { Session } from "./session";
import { assetFor, bestSwapPath, buildSwap, getAccountStatus, swapAmounts } from "./stellar";
import { marketGapProblem, stillGood, swapPolicy } from "./swap-rules";
import { needsSignature, park } from "./testnet";
import { assertInvited } from "./treasury";
import { wallet, type WalletState } from "./store";

/**
 * Real swaps on mainnet (M10). A swap is a Stellar DEX strict-send path
 * payment from the user's wallet to itself, signed by the user's own wallet,
 * through the same approve, caps, sign, submit and log path as a send:
 *   1. approve: every check below, then a fresh route from Horizon. If the
 *      route now gives less than the minimum, the quote is stale: refused.
 *   2. the wallet signs; submitSigned (testnet.ts) runs the checks again and
 *      submits. The transaction itself refuses to fill below the minimum.
 *   3. finishSwap logs what Horizon says was actually received.
 * Aquarius and Soroswap are quoted to compare, not executed (yet).
 */

/** Swaps need naira, which exists on mainnet only. */
export function refuseSwapOffMainnet() {
  if (moneyLive() && !onMainnet()) {
    throw new ApiFailure("SIGNING_UNAVAILABLE", `Swaps need naira (NGNC), which only exists on mainnet, so they're off on ${config.networkLabel}.`, 409);
  }
}

const name = (c: Quote["from"]) => (c === "NGN" ? "naira (NGNC)" : "USDC");

/** Everything that can change between the quote and the signature. Throws on any refusal. */
export async function recheckSwap(s: Session, w: WalletState, quote: Quote) {
  refuseSwapOffMainnet();
  if (quote.status !== "pending") throw new ApiFailure("ALREADY_USED", "That quote was already used or cancelled.", 409);
  assertInvited(s.email);
  if (quote.source !== "live") {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "This quote uses example prices (QUOTE_SOURCE=mock), so it can't be swapped for real.", 409);
  }
  if (quote.executesOn !== "sdex" || quote.minOut === undefined) {
    throw new ApiFailure("QUOTE_EXPIRED", "That quote can't be swapped. Ask for a fresh one.", 410);
  }
  // The price we quoted must be for the same asset we're about to trade.
  for (const c of [quote.from, quote.to]) {
    const a = assetFor(c);
    const q = quotedAsset(c);
    if (!a || a.getCode() !== q.code || a.getIssuer() !== q.issuer) {
      throw new ApiFailure("SIGNING_UNAVAILABLE", `The ${name(c)} we price isn't the one your wallet holds, so I won't swap. Nothing was sent.`, 409);
    }
  }
  checkLimits(w, quote.from, quote.amountIn); // caps apply in the currency being sold
  const st = await getAccountStatus(s.address);
  if (!st.exists || !st.hasTrustline || !st.hasNgncTrustline) {
    throw new ApiFailure("BAD_REQUEST", "Your wallet needs both naira (NGNC) and USDC set up before it can swap. Finish wallet setup first.", 409);
  }
  const bal = (quote.from === "USDC" ? st.usdc : st.ngn) ?? 0;
  if (quote.amountIn > bal) {
    throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough ${name(quote.from)}. Your balance is ${money(bal, quote.from)}.`, 403);
  }
  const gap = marketGapProblem(quote, swapPolicy());
  if (gap) throw new ApiFailure("PRICE_TOO_FAR", gap, 409);
}

/** Called by approveSwap on mainnet after approve: true. Returns the transaction for the wallet to sign. */
export async function startLiveSwap(s: Session, quote: Quote) {
  const w = wallet(s.userId);
  await recheckSwap(s, w, quote);
  const minOut = quote.minOut!;
  const fresh = await bestSwapPath(quote.from, quote.to, quote.amountIn);
  if (!fresh || !stillGood(fresh.destCents, minOut)) {
    quote.status = "expired";
    throw new ApiFailure(
      "QUOTE_EXPIRED",
      `The price moved since this quote: it would now give ${fresh ? money(fresh.destCents, quote.to) : "nothing"}, under the ${money(minOut, quote.to)} minimum. Nothing was swapped. Ask for a fresh quote.`,
      410,
    );
  }
  const tx = await buildSwap({ address: s.address, from: quote.from, to: quote.to, sendCents: quote.amountIn, destMinCents: minOut, path: fresh.path });
  return { ...needsSignature(s, park(w, tx, "swap", quote.id)), quote };
}

/** Records a landed swap once, with what Horizon says was received. A repeat returns the same entry. */
export async function finishSwap(w: WalletState, quote: Quote, hash: string) {
  if (quote.status === "approved") {
    const prior = w.activity.find((a) => a.txRef === hash);
    if (prior) return prior;
  }
  const got = await swapAmounts(hash);
  quote.status = "approved";
  w.spentToday[quote.from] += quote.amountIn;
  const received = got ? money(got.receivedCents, quote.to) : `at least ${money(quote.minOut ?? quote.amountOut, quote.to)}`;
  if (got) quote.received = got.receivedCents;
  return log(w, {
    kind: "swap",
    detail: `${money(quote.amountIn, quote.from)} → ${received} · Stellar DEX`,
    amount: received,
    status: "done",
    txRef: hash,
    explorerUrl: config.explorerTx(hash),
  });
}
