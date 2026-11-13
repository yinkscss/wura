"use client";

import { Gauge } from "@/components/gauge";
import { ShieldIcon } from "@/components/icons";
import { useOverview } from "@/components/overview";
import { Card } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { money } from "@/lib/format";
import type { Currency } from "@/lib/types";

export default function LimitsPage() {
  const { data } = useOverview();
  const l = data?.limits;
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Limits" sub="Example caps. The real amounts aren’t decided yet." />
      <div className="grid gap-5 md:grid-cols-2 [&>*]:min-w-0">
        {(["NGN", "USDC"] as Currency[]).map((c) => (
          <div key={c} className="flex flex-col gap-5 rounded-card bg-[linear-gradient(180deg,#FF9AD0_0%,#FD7BC0_42%,#F34CB0_100%)] p-7 text-white shadow-pink-card">
            <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-white/90">
              Daily limit · {c === "NGN" ? "Naira" : "USDC"}
            </div>
            {l ? (
              <div className="flex flex-wrap items-center gap-6">
                <Gauge value={l.spentToday[c] / l.daily[c]} size={190} />
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[13px] text-white/80">Used today</div>
                    <div className="nums text-[26px] font-bold tracking-[-0.03em]">{money(l.spentToday[c], c)}</div>
                  </div>
                  <div>
                    <div className="text-[13px] text-white/80">Left today</div>
                    <div className="nums text-[26px] font-bold tracking-[-0.03em]">{money(l.remainingToday[c], c)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-40" />
            )}
            <div className="text-[14px] text-white/90">
              {l ? `Daily cap ${money(l.daily[c], c)} · per payment ${money(l.perPayment[c], c)}` : "…"}
            </div>
          </div>
        ))}
      </div>
      <Card className="flex flex-col gap-4 p-7 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue/[0.07]"><ShieldIcon size={19} /></span>
          <h2 className="text-[20px] font-bold tracking-[-0.03em]">How limits are enforced</h2>
        </div>
        <ul className="flex flex-col gap-2.5 text-[15px] text-muted">
          <li>· The server checks every swap and send against the per-payment cap and what’s left of today’s cap, before anything is signed.</li>
          <li>· If a request would go over, Wura stops and tells you. It doesn’t try to send it.</li>
          <li>· Even inside your limits, nothing moves until you approve the preview.</li>
          <li>· Counters reset at midnight, Lagos time.</li>
        </ul>
        {!l && <SkeletonBlock className="h-6 w-40" />}
      </Card>
    </div>
  );
}
