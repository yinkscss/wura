"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { PaymentLink, Quote, SendIntent, VenueQuote } from "@/lib/types";
import { day, money, naira, rate, usdcNumber } from "@/lib/format";
import { CheckIcon, ClockIcon, CopyIcon, LinkIcon, ShareIcon } from "./icons";
import { Button, Eyebrow, Pill, cx } from "./ui";

export function RateRows({
  venues,
  unit,
  compact = false,
}: {
  venues: Pick<VenueQuote, "venue" | "name" | "amountOut" | "best" | "route">[];
  unit: "USDC" | "NGN";
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col", compact ? "gap-[7px]" : "gap-2")}>
      {venues.map((v) => (
        <motion.div
          layout
          key={v.venue}
          className={cx(
            "grid grid-cols-[1fr_auto] items-center rounded-xl",
            compact ? "px-3 py-[9px] text-[13px]" : "px-4 py-3 text-[15px]",
            v.best ? "bg-pink/[0.16] shadow-[inset_0_0_0_1.5px_var(--color-pink)]" : "bg-mist",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold tracking-[-0.02em]">{v.name}</span>
            {v.best && <Pill tone="pink-solid">Best</Pill>}
            {v.route && !compact && <span className="truncate text-[12px] font-medium text-soft">{v.route}</span>}
          </div>
          <span className={cx("nums font-bold tracking-[-0.02em]", v.best && "text-pink-deep")}>
            {unit === "USDC" ? usdcNumber(v.amountOut) : naira(v.amountOut)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function useCountdown(expiresAt: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export type CardState = "pending" | "busy" | "done" | "cancelled" | "error";

function StateFooter({ state, doneText, cancelText }: { state: CardState; doneText: string; cancelText: string }) {
  if (state === "done")
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-full bg-blue/[0.06] px-4 py-3 text-sm font-semibold">
        <span className="grid size-6 place-items-center rounded-full bg-pink text-white"><CheckIcon size={14} /></span>
        {doneText}
      </motion.div>
    );
  if (state === "cancelled")
    return <div className="rounded-full bg-mist px-4 py-3 text-center text-sm font-semibold text-muted">{cancelText}</div>;
  return null;
}

function MarketCheck({ pct, marketRate, source }: { pct: number; marketRate: number; source: string }) {
  const bad = pct <= -3;
  const odd = pct >= 3;
  return (
    <div className={cx("rounded-xl px-4 py-3 text-[13px]", bad || odd ? "bg-pink/15 text-pink-deep" : "bg-mist text-muted")}>
      {bad ? (
        <>
          <b>{Math.abs(pct).toFixed(0)}% worse than the market rate</b> (₦{rate(marketRate)} per $1, {source}). Naira liquidity on Stellar is thin right now.
        </>
      ) : odd ? (
        <>
          <b>{pct.toFixed(0)}% more than the market rate</b> (₦{rate(marketRate)} per $1, {source}). The naira token is trading below ₦1 on Stellar, so check you can cash it out at face value.
        </>
      ) : (
        <>
          Within {Math.abs(pct).toFixed(1)}% of the market rate (₦{rate(marketRate)} per $1, {source}).
        </>
      )}
    </div>
  );
}

export function QuoteCard({
  quote,
  state,
  onApprove,
  onCancel,
  onRefresh,
}: {
  quote: Quote;
  state: CardState;
  onApprove?: () => void;
  onCancel?: () => void;
  onRefresh?: () => void;
}) {
  const live = state === "pending" || state === "busy" || state === "error";
  const left = useCountdown(quote.expiresAt, live);
  const expired = live && left === 0;
  const buying = quote.to === "USDC";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>{state === "done" ? "Swap · done" : "Preview · not sent yet"}</Eyebrow>
        <div className="mt-2 text-[15px] font-medium text-muted">You’ll get</div>
        <div className="nums mt-0.5 text-[40px] font-bold leading-none tracking-[-0.045em] text-pink-deep">
          {buying ? `${usdcNumber(quote.amountOut)} USDC` : naira(quote.amountOut)}
        </div>
        <div className="mt-2 text-[14px] text-muted">
          for {money(quote.amountIn, quote.from)} · 1 USDC = ₦{rate(quote.rate)}
        </div>
      </div>
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[12.5px] text-soft">You pay</div>
          <div className="nums mt-1 text-[16px] font-bold">{money(quote.amountIn, quote.from, true)}</div>
        </div>
        <div>
          <div className="text-[12.5px] text-soft">{quote.source === "live" ? "Venue fees" : "Fee (in the rate)"}</div>
          <div className="nums mt-1 text-[16px] font-bold">
            {quote.source === "live" ? "Included in quote" : money(quote.fee, quote.from, true)}
          </div>
        </div>
      </div>
      <RateRows venues={quote.venues} unit={quote.to} />
      {quote.unquoted.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl bg-mist px-4 py-3 text-[13px] text-muted">
          {quote.unquoted.map((u) => (
            <span key={u.venue}>
              <b className="text-blue">{u.name}</b> not compared: {u.reason.charAt(0).toLowerCase() + u.reason.slice(1)}.
            </span>
          ))}
        </div>
      )}
      {quote.market && quote.vsMarketPct !== undefined && (
        <MarketCheck pct={quote.vsMarketPct} marketRate={quote.market.rate} source={quote.market.source} />
      )}
      {live && !expired && (
        <div className="flex items-center justify-between text-[12.5px] text-soft">
          <span>{quote.source === "live" ? "Live Stellar mainnet prices · swap is simulated" : "Example rates · mock mode"}</span>
          <span className="nums">Quote valid {left}s</span>
        </div>
      )}
      {live && expired ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">This quote expired. Prices move, so get a fresh one.</p>
          <Button variant="blue" onClick={onRefresh}>Get a new quote</Button>
        </div>
      ) : live ? (
        <div className="grid grid-cols-[1fr_1.3fr] gap-3">
          <Button variant="outline-blue" size="lg" onClick={onCancel} disabled={state === "busy"}>
            Cancel
          </Button>
          <Button size="lg" onClick={onApprove} disabled={state === "busy"}>
            {state === "busy" ? "Approving…" : "Approve"}
          </Button>
        </div>
      ) : (
        <StateFooter state={state} doneText="Approved and swapped (mock)" cancelText="Cancelled. Nothing was sent." />
      )}
    </div>
  );
}

export function SendCard({
  intent,
  state,
  onConfirm,
  onCancel,
  onRefresh,
}: {
  intent: SendIntent;
  state: CardState;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRefresh?: () => void;
}) {
  const live = state === "pending" || state === "busy" || state === "error";
  const left = useCountdown(intent.expiresAt, live);
  const expired = live && left === 0;
  const used = intent.dailyLimit - intent.dailyRemainingAfter;
  const usedPct = Math.min(100, (used / intent.dailyLimit) * 100);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>{state === "done" ? "Sent" : "Confirm send · not sent yet"}</Eyebrow>
        <div className="mt-2 text-[15px] font-medium text-muted">You’re sending</div>
        <div className="nums mt-0.5 text-[40px] font-bold leading-none tracking-[-0.045em]">
          {usdcNumber(intent.amount)} <span className="text-pink-deep">USDC</span>
        </div>
        <div className="mt-2 text-[14px] text-muted">
          to {intent.to.name}
          {!intent.to.name.includes("…") && <span className="font-mono text-[12.5px]"> ({intent.to.address.slice(0, 4)}…{intent.to.address.slice(-4)})</span>} · from your USDC balance
        </div>
      </div>
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="To" value={intent.to.name} />
        {intent.fee === 0 ? (
          // Real network: the fee is paid in XLM.
          <Field label="Network fee" value="Paid in XLM" />
        ) : (
          <Field label="Fee (example)" value={`${usdcNumber(intent.fee)} USDC`} />
        )}
        <Field label="Your balance" value={`${usdcNumber(intent.balanceBefore)} USDC`} />
        <Field label="Total debit" value={`${usdcNumber(intent.total)} USDC`} />
      </div>
      <div className="flex gap-3 rounded-2xl bg-mist p-4">
        <ClockIcon size={18} className="mt-0.5 shrink-0 text-pink-deep" />
        <div className="flex-1 text-[14px] leading-snug text-muted">
          <span className="font-bold text-blue">Daily limit after this</span> — {usdcNumber(intent.dailyRemainingAfter)} of{" "}
          {usdcNumber(intent.dailyLimit)} USDC left
          <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-pink"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(4, usedPct)}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          Per-payment cap {usdcNumber(intent.perPaymentCap)} USDC · within limit
          <div className="mt-1 text-[12px] text-soft">Example limits. Real amounts aren’t set yet.</div>
        </div>
      </div>
      {live && expired ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">This preview expired. Prepare it again to send.</p>
          <Button variant="blue" onClick={onRefresh}>Prepare again</Button>
        </div>
      ) : live ? (
        <div className="grid grid-cols-[1fr_1.3fr] gap-3">
          <Button variant="outline-blue" size="lg" onClick={onCancel} disabled={state === "busy"}>Cancel</Button>
          <Button size="lg" onClick={onConfirm} disabled={state === "busy"}>
            {state === "busy" ? (intent.fee === 0 ? "Signing and sending…" : "Sending…") : "Confirm send"}
          </Button>
        </div>
      ) : (
        <StateFooter
          state={state}
          doneText={intent.fee === 0 ? `Sent to ${intent.to.name} on Stellar` : `Sent to ${intent.to.name} (mock)`}
          cancelText="Cancelled. Nothing was sent."
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12.5px] text-soft">{label}</div>
      <div className="nums mt-1 text-[16px] font-bold">{value}</div>
    </div>
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LinkCard({ link }: { link: PaymentLink }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const display = link.url.replace(/^https?:\/\//, "");
  const amount = link.currency === "NGN" ? naira(link.amount) : `${usdcNumber(link.amount)} USDC`;

  async function onCopy() {
    if (await copyText(link.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }
  async function onShare() {
    const data = { title: "Payment request", text: `Pay me ${amount}`, url: link.url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      return; // user closed the share sheet
    }
    if (await copyText(`${data.text}: ${link.url}`)) {
      setShared("Message copied — paste it anywhere");
      setTimeout(() => setShared(null), 2200);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>Payment link · active</Eyebrow>
        <div className="nums mt-2 text-[40px] font-bold leading-none tracking-[-0.045em]">{amount}</div>
        <div className="mt-2 text-[14px] text-muted">Request · expires {day(link.expiresAt)} (7 days)</div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-mist px-4 py-3.5">
        <LinkIcon size={16} className="shrink-0 text-blue/55" />
        <code className="min-w-0 truncate font-sans text-[15px] font-semibold">{display}</code>
      </div>
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Status" value="Open · not paid yet" />
        <Field label="Currency" value={link.currency} />
      </div>
      <div className="grid grid-cols-[1fr_1.3fr] gap-3">
        <Button variant="outline-blue" size="lg" onClick={onCopy} aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? "y" : "n"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="inline-flex items-center gap-2"
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              {copied ? "Copied" : "Copy"}
            </motion.span>
          </AnimatePresence>
        </Button>
        <Button size="lg" onClick={onShare}>
          <ShareIcon size={16} /> Share
        </Button>
      </div>
      {shared && <p className="text-center text-[12.5px] text-muted">{shared}</p>}
      <p className="text-[12px] text-soft">Example link on a reserved test domain. It isn’t a working payment page yet.</p>
    </div>
  );
}
