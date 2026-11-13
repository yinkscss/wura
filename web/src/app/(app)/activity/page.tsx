"use client";

import { useOverview } from "@/components/overview";
import { Card, Pill } from "@/components/ui";
import { ActivityTable, PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { day, naira, usdc } from "@/lib/format";

export default function ActivityPage() {
  const { data } = useOverview();
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Activity" sub="Every move Wura makes is written here. Example entries are marked as preview data." />
      <Card className="p-6 shadow-soft sm:p-7">
        <h2 className="mb-4 text-[20px] font-bold tracking-[-0.03em]">Transaction log</h2>
        {data ? <ActivityTable rows={data.activity} /> : <SkeletonBlock className="h-72" />}
      </Card>
      <Card className="p-6 shadow-soft sm:p-7">
        <h2 className="mb-4 text-[20px] font-bold tracking-[-0.03em]">Payment links</h2>
        {!data ? (
          <SkeletonBlock className="h-32" />
        ) : data.links.length === 0 ? (
          <p className="text-[14px] text-muted">No payment links yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="nums text-[17px] font-bold">{l.currency === "NGN" ? naira(l.amount) : usdc(l.amount)}</div>
                  <div className="truncate text-[13.5px] text-muted">
                    {l.url.replace(/^https?:\/\//, "")} · expires {day(l.expiresAt)}
                  </div>
                </div>
                <Pill tone="pink">{l.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
