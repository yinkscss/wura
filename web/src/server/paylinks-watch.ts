import "server-only";
import { money } from "@/lib/format";
import type { PaymentLink } from "@/lib/types";
import { config, moneyLive } from "./config";
import { log } from "./money";
import { applyPayments, type LinkAsset } from "./paylinks";
import { assetFor, incomingPaymentsWithMemo } from "./stellar";
import { findLink, wallet, watchedLinks, withWallet } from "./store";

/**
 * The payment link watcher (M5). It asks Horizon what arrived at the creator's
 * address with the link's memo, then lets applyPayments decide the link's state.
 *
 * Runs when someone opens /pay/<code>, when the creator opens their wallet or
 * links list, and from /api/cron/links. That route only runs if a scheduler calls
 * it (see CRON_SECRET in .env.example), so without one a payment is noticed the
 * next time someone looks. It is safe to run any number of times at once: payments are
 * kept by Horizon operation id, the wallet row is locked while the result is
 * saved, and "paid" is written to the log only on the run that first sees it.
 */

const MIN_GAP_MS = 10_000;
const g = globalThis as unknown as { __linkChecked?: Map<string, number> };
const checked = () => (g.__linkChecked ??= new Map());

export function linkAsset(currency: PaymentLink["currency"]): LinkAsset | null {
  const a = assetFor(currency);
  return a ? { code: a.getCode(), issuer: a.getIssuer() ?? "" } : null;
}

/** Checks one link on Horizon and saves what it finds. Returns the link as it now stands. */
export async function refreshLink(userId: string, link: PaymentLink, opts: { force?: boolean } = {}): Promise<PaymentLink> {
  if (!moneyLive() || !link.address || !link.memo) return link;
  const asset = linkAsset(link.currency);
  if (!asset) return link;
  const now = Date.now();
  const last = checked().get(link.code) ?? 0;
  if (!opts.force && now - last < MIN_GAP_MS) return link;
  checked().set(link.code, now);

  // Horizon first, outside the wallet lock; only the saving happens inside it.
  const seen = await incomingPaymentsWithMemo(link.address, link.memo, link.createdAt);

  return withWallet(userId, async () => {
    const w = wallet(userId);
    const i = w.links.findIndex((l) => l.code === link.code);
    if (i < 0) return link;
    const before = w.links[i];
    const after = applyPayments(before, asset, seen, Date.now());
    w.links[i] = after;

    const had = new Set((before.payments ?? []).map((p) => p.id));
    const fmt = (n: number) => money(n, after.currency);
    for (const p of after.payments ?? []) {
      if (had.has(p.id)) continue;
      const base = { kind: "link" as const, txRef: p.hash, explorerUrl: config.explorerTx(p.hash) };
      if (p.kind === "counted") {
        const nowPaid = before.status !== "paid" && after.status === "paid" && after.paidTx === p.hash;
        log(w, { ...base, detail: nowPaid ? "Payment link paid" : "Part payment on a payment link", amount: fmt(nowPaid ? after.receivedMinor ?? p.amount : p.amount), status: nowPaid ? "done" : "open" });
      } else {
        const why = { late: "after the link expired", extra: "after it was already paid", wrong_asset: "in the wrong asset" }[p.kind];
        log(w, { ...base, detail: `Payment link: a payment arrived ${why} and wasn't counted`, amount: p.kind === "wrong_asset" ? `${p.amount / 100} ${p.assetCode}` : fmt(p.amount), status: "refused" });
      }
    }
    if (before.status !== "expired" && after.status === "expired" && (after.payments ?? []).length === 0) {
      log(w, { kind: "link", detail: "Payment link expired, nothing received", amount: fmt(after.amount), status: "refused" });
    }
    return after;
  });
}

/** Refresh by public code. Unknown codes do nothing and never reach Horizon. */
export async function refreshByCode(code: string): Promise<{ userId: string; link: PaymentLink } | null> {
  const found = await findLink(code);
  if (!found) return null;
  try {
    return { userId: found.userId, link: await refreshLink(found.userId, found.link) };
  } catch {
    // Horizon is down or slow: show what we last knew rather than an error page.
    return found;
  }
}

/** Every watched link, one by one. Returns counts for the cron response. */
export async function refreshAllLinks(): Promise<{ checked: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const { userId, link } of await watchedLinks()) {
    try {
      await refreshLink(userId, link, { force: true });
      ok++;
    } catch {
      failed++;
    }
  }
  return { checked: ok, failed };
}
