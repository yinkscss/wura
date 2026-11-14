"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Activity } from "@/lib/types";
import { when } from "@/lib/format";
import { ChatGPTLogo, ClaudeLogo, TelegramLogo, WhatsAppLogo } from "./brand-icons";
import { RefreshIcon } from "./icons";
import { useOverview } from "./overview";
import { Card, Pill, cx } from "./ui";

const KIND_LABEL: Record<Activity["kind"], string> = { swap: "Swap", send: "Send", link: "Link", fund: "Fund", site: "Site" };

export function ActivityTable({ rows, limit }: { rows: Activity[]; limit?: number }) {
  const list = limit ? rows.slice(0, limit) : rows;
  if (!list.length) {
    return <p className="py-10 text-center text-[14px] text-muted">No activity yet. Swaps, sends and payment links show up here.</p>;
  }
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="text-[12px] font-semibold uppercase tracking-[0.1em] text-soft">
            <th className="pb-3 pr-4 font-semibold">When</th>
            <th className="pb-3 pr-4 font-semibold">Type</th>
            <th className="pb-3 pr-4 font-semibold">Detail</th>
            <th className="pb-3 pr-4 font-semibold">Amount</th>
            <th className="pb-3 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a, i) => (
            <motion.tr
              key={a.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04 }}
              className="border-t border-line text-[14.5px]"
            >
              <td className="nums whitespace-nowrap py-[17px] pr-4">{when(a.at)}</td>
              <td className="py-[17px] pr-4">{KIND_LABEL[a.kind]}</td>
              <td className="py-[17px] pr-4">
                {a.detail}
                {a.explorerUrl && a.txRef ? (
                  <a
                    href={a.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-mono text-[11.5px] text-pink-deep underline underline-offset-2"
                    title="View on Stellar Expert (testnet)"
                  >
                    {a.txRef.slice(0, 8)}…↗
                  </a>
                ) : (
                  a.txRef &&
                  a.txRef !== "example" && (
                    <span className="ml-2 font-mono text-[11.5px] text-soft" title="Mock transaction reference">
                      {a.txRef}
                    </span>
                  )
                )}
              </td>
              <td className="nums whitespace-nowrap py-[17px] pr-4 font-bold">{a.amount}</td>
              <td className="py-[17px] text-right">
                <Pill tone={a.status === "open" ? "pink" : "blue"}>{a.status === "done" ? "Done" : a.status}</Pill>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const APPS = [
  { name: "Claude", kind: "Connector · balance, rates, favourites", tile: "bg-[#D97757] text-white", Logo: ClaudeLogo, live: true },
  { name: "ChatGPT", kind: "Same assistant · chat plugin", tile: "bg-[#10A37F] text-white", Logo: ChatGPTLogo },
  { name: "Telegram", kind: "Same assistant · bot", tile: "bg-[#26A5E4] text-white", Logo: TelegramLogo },
  { name: "WhatsApp", kind: "Same assistant · bot", tile: "bg-[#25D366] text-white", Logo: WhatsAppLogo },
];

/** Brand marks label each app. Claude is live as a connector; Telegram shows "Live" when this server has the bot set up. */
export function ConnectedApps({ big = false }: { big?: boolean }) {
  const [telegramOn, setTelegramOn] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("/api/telegram/link")
      .then((s) => setTelegramOn(s.enabled))
      .catch(() => {});
  }, []);
  const available = telegramOn ? ["Telegram"] : [];
  return (
    <div className="flex flex-col gap-3">
      {APPS.map((a) => (
        <div key={a.name} className={cx("flex items-center gap-4 rounded-2xl bg-mist", big ? "p-4" : "px-3.5 py-3")}>
          <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl", a.tile)}>
            <a.Logo size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-bold tracking-[-0.02em]">{a.name}</div>
            <div className="truncate text-[13px] text-muted">{a.kind}</div>
          </div>
          {("live" in a && a.live) || available.includes(a.name) ? <Pill tone="pink">Live</Pill> : <Pill tone="blue">Soon</Pill>}
        </div>
      ))}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cx("shimmer-bg animate-shimmer rounded-xl", className)} />;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-bold tracking-[-0.045em] sm:text-[38px]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  );
}

/** Re-fetches the wallet overview; the icon spins until the new numbers arrive. */
export function RefreshButton({ label = "Refresh balance" }: { label?: string }) {
  const { refresh } = useOverview();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-full text-soft transition hover:bg-mist hover:text-blue disabled:cursor-wait"
    >
      <RefreshIcon size={17} className={busy ? "animate-spin" : undefined} />
    </button>
  );
}

export function StatCard({ label, children, foot, className, refreshable }: { label: string; children: React.ReactNode; foot?: React.ReactNode; className?: string; refreshable?: boolean }) {
  return (
    <Card className={cx("flex min-h-[210px] flex-col p-6 shadow-soft", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-soft">{label}</div>
        {refreshable && <RefreshButton />}
      </div>
      <div className="mt-3">{children}</div>
      {foot && <div className="mt-auto pt-6 text-[14px] text-muted">{foot}</div>}
    </Card>
  );
}
