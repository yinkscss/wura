import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { money } from "@/lib/format";
import { config, moneyLive } from "@/server/config";
import { linkAsset, refreshByCode } from "@/server/paylinks-watch";
import { payUri } from "@/server/paylinks";
import { CopyField } from "./copy-field";

export const metadata: Metadata = { title: "Pay with Wura", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Public payment page. Shows only what a payer needs: who gets paid (a wallet
 * address, which is public anyway), how much, and the memo. Never the owner's
 * email or user id. The money goes straight to the creator's wallet.
 */
export default async function PayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const found = /^[A-Z0-9-]{4,24}$/.test(code) ? await refreshByCode(code) : null;
  if (!found || !found.link.address || !found.link.memo) notFound();
  const { link } = found;

  const live = moneyLive();
  const asset = linkAsset(link.currency);
  const amount = money(link.amount, link.currency);
  const paidSoFar = money(link.receivedMinor ?? 0, link.currency);
  const expired = link.status === "expired";
  const closed = link.status === "paid" || expired;
  const late = (link.payments ?? []).filter((p) => p.kind === "late").length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-10">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Payment request · {config.networkLabel}</p>
        <h1 className="nums mt-2 text-[40px] font-bold leading-none tracking-[-0.045em]">{amount}</h1>
        <p className="mt-2 text-[14px] text-muted">
          {link.status === "paid" && "Paid. Thank you, nothing more is needed."}
          {link.status === "partial" && `Part paid: ${paidSoFar} of ${amount} so far. Send the rest with the same memo.`}
          {link.status === "open" && "Not paid yet."}
          {expired && "This link has expired. Don't send money to it."}
        </p>
      </div>

      {!live && (
        <p className="rounded-2xl bg-mist px-4 py-3 text-[13px] text-muted">
          This is a demo link. This app isn’t connected to a live network, so nothing can be paid here.
        </p>
      )}

      {live && !closed && asset && (
        <section className="flex flex-col gap-4 rounded-2xl border border-line p-4">
          <p className="text-[13px] text-muted">
            Pay from any Stellar wallet. Send {link.currency === "NGN" ? "NGNC (naira)" : "USDC"} to this address and include the memo exactly, or Wura can’t match your payment.
          </p>
          <CopyField label="Address" value={link.address} />
          <CopyField label="Memo (text)" value={link.memo} />
          <a
            href={payUri(link, asset)}
            className="rounded-xl bg-blue px-4 py-3 text-center text-[15px] font-semibold text-white"
          >
            Open in my wallet
          </a>
          <p className="text-[12px] text-soft">
            Pay at least {amount} before {new Date(link.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. A payment without the memo, or in another asset, won’t count.
          </p>
        </section>
      )}

      {late > 0 && (
        <p className="rounded-2xl bg-mist px-4 py-3 text-[13px] text-muted">
          {late} payment{late === 1 ? "" : "s"} arrived after this link expired and weren’t counted. The person who made the link can see them.
        </p>
      )}
    </main>
  );
}
