/**
 * Payment links: the rules for deciding what a link has received. Pure, so
 * every case (short, late, double, wrong asset) can be tested without Horizon.
 * No "server-only" import on purpose: tests load this file directly.
 *
 * See docs/mainnet-plan.md, M5.
 */

import type { Currency, LinkPayment, PaymentLink } from "@/lib/types";

/** What Horizon told us about one payment to the creator's address (already filtered to successful ones). */
export type SeenPayment = {
  /** Horizon operation id. Unique per payment, so seeing it twice changes nothing. */
  id: string;
  hash: string;
  /** Decimal string with up to 7 places, as Horizon sends it. */
  amount: string;
  assetCode: string;
  assetIssuer: string;
  /** Text memo of the transaction, if it had one. */
  memo: string | null;
  at: number;
};

const STROOPS = BigInt(10_000_000);
const MINOR = BigInt(100_000); // one cent or kobo, in stroops

/** "12.3400000" to stroops. Anything that isn't a plain decimal is 0, which can never complete a link. */
export function toStroops(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!m) return BigInt(0);
  return BigInt(m[1]) * STROOPS + BigInt((m[2] ?? "").padEnd(7, "0"));
}

/** Stroops to cents or kobo, rounded down (we never show more than was received). */
export const stroopsToMinor = (s: bigint) => Number(s / MINOR);

const minorToStroops = (minor: number) => BigInt(minor) * MINOR;

export type LinkAsset = { code: string; issuer: string };

/** The SEP-7 payment URI a wallet can open: web+stellar:pay?destination=… */
export function payUri(link: Pick<PaymentLink, "address" | "memo" | "amount" | "currency">, asset: LinkAsset): string {
  const q = new URLSearchParams({
    destination: link.address,
    amount: (link.amount / 100).toFixed(2),
    asset_code: asset.code,
    asset_issuer: asset.issuer,
    memo: link.memo,
    memo_type: "MEMO_TEXT",
  });
  return `web+stellar:pay?${q.toString()}`;
}

/**
 * Re-reads a link from every payment we know of. Payments are matched on the
 * link's memo; they are never matched on amount alone.
 *
 *   counted      arrived before expiry, right asset: adds to what's paid
 *   late         right memo and asset, but after expiry: shown, never counted
 *   extra        arrived after the link was already paid in full: shown, never counted
 *   wrong_asset  right memo, other asset: shown, never counted
 *
 * The link is "paid" once counted payments add up to at least the amount.
 * Paid is final. "partial" means something arrived but not enough yet.
 * Same inputs always give the same result, so running it twice does nothing.
 */
export function applyPayments(
  link: PaymentLink,
  asset: LinkAsset,
  seen: SeenPayment[],
  now = Date.now(),
): PaymentLink {
  const known = new Map<string, LinkPayment>((link.payments ?? []).map((p) => [p.id, p]));
  for (const s of seen) {
    if (s.memo !== link.memo || known.has(s.id)) continue;
    if (s.at < link.createdAt) continue;
    known.set(s.id, {
      id: s.id,
      hash: s.hash,
      amount: stroopsToMinor(toStroops(s.amount)),
      stroops: toStroops(s.amount).toString(),
      assetCode: s.assetCode,
      assetIssuer: s.assetIssuer,
      at: s.at,
      kind: "counted", // decided below
    });
  }

  const ordered = [...known.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const need = minorToStroops(link.amount);
  let total = BigInt(0);
  let paidAt: number | undefined;
  let paidTx: string | undefined;

  const payments: LinkPayment[] = ordered.map((p) => {
    // Code and issuer must both match: a look-alike token with the same code is not money.
    const sameAsset = p.assetCode === asset.code && p.assetIssuer === asset.issuer;
    let kind: LinkPayment["kind"];
    if (!sameAsset) kind = "wrong_asset";
    else if (p.at > link.expiresAt) kind = "late";
    else if (paidAt !== undefined) kind = "extra";
    else {
      kind = "counted";
      total += BigInt(p.stroops);
      if (total >= need) {
        paidAt = p.at;
        paidTx = p.hash;
      }
    }
    return { ...p, kind };
  });

  const status: PaymentLink["status"] =
    paidAt !== undefined ? "paid" : now > link.expiresAt ? "expired" : total > BigInt(0) ? "partial" : "open";

  return {
    ...link,
    status,
    payments,
    receivedMinor: stroopsToMinor(total),
    paidAt,
    paidTx,
  };
}

/** What the creator sees as the state of a link, in plain words. */
export function linkStateText(link: PaymentLink, fmt: (minor: number, c: Currency) => string): string {
  const got = fmt(link.receivedMinor ?? 0, link.currency);
  const lateOrWrong = (link.payments ?? []).some((p) => p.kind === "late" || p.kind === "wrong_asset");
  const extra = (link.payments ?? []).filter((p) => p.kind === "extra").length;
  switch (link.status) {
    case "paid": {
      const odd = extra + (link.payments ?? []).filter((p) => p.kind === "late" || p.kind === "wrong_asset").length;
      return odd > 0 ? `Paid. ${odd} other payment${odd === 1 ? "" : "s"} also arrived and weren't counted. Check Activity.` : "Paid";
    }
    case "partial":
      return `Part paid: ${got} of ${fmt(link.amount, link.currency)} so far`;
    case "expired":
      return lateOrWrong || (link.receivedMinor ?? 0) > 0
        ? `Expired. ${got} of ${fmt(link.amount, link.currency)} arrived in time. Check Activity for the rest.`
        : "Expired, nothing received";
    default:
      return "Open · not paid yet";
  }
}
