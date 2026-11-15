"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Activity } from "@/lib/types";
import { when } from "@/lib/format";
import { ChatGPTLogo, ClaudeLogo, TelegramLogo, WhatsAppLogo } from "./brand-icons";
import { CheckIcon, CopyIcon, RefreshIcon } from "./icons";
import { copyText } from "./money-cards";
import { useOverview } from "./overview";
import { buttonClass, Card, Pill, cx } from "./ui";

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
  { name: "Claude", kind: "Same assistant · connector", tile: "bg-[#D97757] text-white", Logo: ClaudeLogo },
  { name: "ChatGPT", kind: "Same assistant · connector", tile: "bg-[#10A37F] text-white", Logo: ChatGPTLogo },
  { name: "Telegram", kind: "Same assistant · bot", tile: "bg-[#26A5E4] text-white", Logo: TelegramLogo },
  { name: "WhatsApp", kind: "Same assistant · bot", tile: "bg-[#25D366] text-white", Logo: WhatsAppLogo },
];

/** Opens Claude's "Add custom connector" dialog with Wura's name and URL filled in; the user confirms there. */
function addToClaudeUrl(origin: string) {
  return `https://claude.ai/customize/connectors?${new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "Wura",
    connectorUrl: `${origin}/mcp`,
  })}`;
}

/** ChatGPT has no prefill link: this page is where a custom MCP server is added (OpenAI docs, Nov 2026). */
const CHATGPT_PLUGINS_URL = "https://chatgpt.com/plugins";

const isHost = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Brand marks label each app. Claude and ChatGPT show an add button until
 * this user has connected them (an OAuth grant whose redirect is on
 * claude.ai/claude.com or chatgpt.com), then "Live". Telegram shows "Live"
 * when this server has the bot set up.
 */
export function ConnectedApps({ big = false }: { big?: boolean }) {
  const [telegramOn, setTelegramOn] = useState(false);
  const [conn, setConn] = useState<{ claude: boolean; chatgpt: boolean; origin: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("/api/telegram/link")
      .then((s) => setTelegramOn(s.enabled))
      .catch(() => {});
    api<{ redirectHost: string }[]>("/api/connected-apps")
      .catch(() => [] as { redirectHost: string }[])
      .then((apps) =>
        setConn({
          claude: apps.some((a) => isHost(a.redirectHost, ["claude.ai", "claude.com"])),
          chatgpt: apps.some((a) => isHost(a.redirectHost, ["chatgpt.com"])),
          origin: window.location.origin,
        }),
      );
  }, []);

  function status(name: string) {
    if (name === "Claude" || name === "ChatGPT") {
      if (!conn) return null;
      if (name === "Claude" ? conn.claude : conn.chatgpt) return <Pill tone="pink">Live</Pill>;
      return name === "Claude" ? (
        <a href={addToClaudeUrl(conn.origin)} target="_blank" rel="noopener noreferrer" aria-label="Add to Claude" className={buttonClass("blue", "sm", "shrink-0")}>
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">Add to Claude</span>
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setGuideOpen((o) => !o)}
          aria-expanded={guideOpen}
          aria-label={guideOpen ? "Close ChatGPT setup" : "Add to ChatGPT"}
          className={buttonClass(guideOpen ? "outline-blue" : "blue", "sm", "shrink-0")}
        >
          {guideOpen ? (
            "Close"
          ) : (
            <>
              <span className="sm:hidden">Add</span>
              <span className="hidden sm:inline">Add to ChatGPT</span>
            </>
          )}
        </button>
      );
    }
    if (name === "Telegram" && telegramOn) return <Pill tone="pink">Live</Pill>;
    return <Pill tone="blue">Soon</Pill>;
  }

  return (
    <div className="flex flex-col gap-3">
      {APPS.map((a) => (
        <div key={a.name} className={cx("rounded-2xl bg-mist", big ? "p-4" : "px-3.5 py-3")}>
          <div className="flex items-center gap-4">
            <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl", a.tile)}>
              <a.Logo size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15.5px] font-bold tracking-[-0.02em]">{a.name}</div>
              <div className="truncate text-[13px] text-muted">{a.kind}</div>
            </div>
            {status(a.name)}
          </div>
          {a.name === "ChatGPT" && guideOpen && conn && !conn.chatgpt && <ChatGPTGuide url={`${conn.origin}/mcp`} />}
        </div>
      ))}
    </div>
  );
}

/** ChatGPT can't be prefilled from a link, so this walks through adding Wura by hand. */
function ChatGPTGuide({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }
  const steps = [
    <>Copy Wura’s address.</>,
    <>
      In ChatGPT, open <b>Plugins</b>, tap <b>+</b>, then <b>Add custom MCP server</b>.
    </>,
    <>
      Name it <b>Wura</b>, paste the address, and choose <b>OAuth</b> for authentication.
    </>,
    <>
      Tap <b>I understand and want to continue</b>, then <b>Create as a plugin</b>.
    </>,
    <>
      Sign in to Wura when asked and tap <b>Allow</b>. Then just ask, e.g. “send $1 to Isaac”.
    </>,
  ];
  return (
    <div className="mt-4 rounded-xl bg-white p-4 shadow-soft">
      <ol className="flex flex-col gap-3">
        {steps.map((step, n) => (
          <li key={n} className="flex gap-3 text-[13.5px] leading-snug">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-blue text-[11px] font-bold text-white">{n + 1}</span>
            <div className="min-w-0 flex-1 pt-px">
              {step}
              {n === 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-mist py-1.5 pl-3 pr-1.5">
                  <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-blue">{url}</code>
                  <button
                    type="button"
                    onClick={copy}
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[12px] font-semibold text-blue"
                  >
                    {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={CHATGPT_PLUGINS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("blue", "sm")}>
          Open ChatGPT
        </a>
        <span className="text-[12px] text-soft">Your ChatGPT plan has to allow custom MCP servers.</span>
      </div>
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
