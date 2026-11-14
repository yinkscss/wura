"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRightIcon, BackIcon, SparkIcon } from "@/components/icons";
import { LinkCard, QuoteCard, RateRows, SendCard, type CardState } from "@/components/money-cards";
import { useOverview } from "@/components/overview";
import { Button, Card, cx } from "@/components/ui";
import { api, ClientApiError } from "@/lib/api";
import { naira, usdc, usdcNumber } from "@/lib/format";
import type { AgentCard, AgentReply, NeedsSignature, Quote, SendIntent, SiteAction, SiteConnectRequest } from "@/lib/types";
import { useCompleteSigning } from "@/lib/signing";
import { SiteActionCard, SitePermissionCard } from "@/components/site-cards";

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; text: string; card?: AgentCard; state?: CardState; prompt?: string; href?: string };

const SUGGESTIONS = [
  "Change ₦50,000 to dollars",
  "Send $20 to Tunde",
  "Make a payment link for ₦15,000",
  "How much do I have left?",
  "What’s the best rate right now?",
  "Connect to market.example.org and buy 2 posters",
];

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

export function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, refresh } = useOverview();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [showNgn, setShowNgn] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date());

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  const patch = useCallback((id: string, p: Partial<Extract<Msg, { role: "agent" }>>) => {
    setMsgs((m) => m.map((x) => (x.id === id && x.role === "agent" ? { ...x, ...p } : x)));
  }, []);

  const say = useCallback((text: string, card?: AgentCard, href?: string) => {
    setMsgs((m) => [...m, { id: uid(), role: "agent", text, card, href }]);
  }, []);
  const completeSigning = useCompleteSigning();

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || thinking) return;
      setInput("");
      setMsgs((m) => [...m, { id: uid(), role: "user", text: t }]);
      setThinking(true);
      try {
        const [reply] = await Promise.all([
          api<AgentReply>("/api/agent", {
            message: t,
            // Recent lines as plain text, so follow-ups like "make it 30k" make sense.
            history: msgs.slice(-8).map((m) => ({ role: m.role, text: m.text })),
          }),
          new Promise((r) => setTimeout(r, 650)),
        ]);
        if (reply.card?.type === "link") setShowNgn(reply.card.link.currency === "NGN");
        if (reply.card?.type === "quote" || reply.card?.type === "send") setShowNgn(false);
        setMsgs((m) => [
          ...m,
          { id: uid(), role: "agent", text: reply.text, card: reply.card, state: "pending", prompt: t },
        ]);
        if (reply.card?.type === "link") void refresh();
      } catch (e) {
        say(e instanceof ClientApiError ? e.message : "I couldn't reach the server. Nothing was sent.");
      } finally {
        setThinking(false);
      }
    },
    [thinking, refresh, say, msgs],
  );

  // Deep link: /chat?prompt=...
  useEffect(() => {
    const p = params.get("prompt");
    if (p && !autoSent.current) {
      autoSent.current = true;
      router.replace("/chat");
      void send(p);
    }
  }, [params, router, send]);

  async function approveQuote(msgId: string, quote: Quote) {
    patch(msgId, { state: "busy" });
    try {
      const res = await api<{ quote: Quote; activity: { txRef?: string }; mock: boolean }>("/api/swap/approve", {
        quoteId: quote.id,
        approve: true,
      });
      patch(msgId, { state: "done" });
      const got = quote.to === "USDC" ? usdc(quote.amountOut) : naira(quote.amountOut);
      say(`Done. ${got} is in your wallet. Reference ${res.activity.txRef}${res.mock ? " (mock — nothing was broadcast)" : ""}.`);
      void refresh();
    } catch (e) {
      const err = e as ClientApiError;
      patch(msgId, { state: err.code === "QUOTE_EXPIRED" ? "pending" : "error" });
      say(err.message ?? "That didn't go through. Nothing was sent.", {
        type: "refused",
        code: err.code,
        title: "Not swapped",
        lines: [],
      });
    }
  }

  async function confirmSend(msgId: string, intent: SendIntent) {
    patch(msgId, { state: "busy" });
    try {
      type Done = { activity: { txRef?: string; explorerUrl?: string }; mock: boolean };
      // On testnet with Privy this returns needs_signature: the wallet signs, then we submit.
      const res = await completeSigning<Done>(
        await api<Done | NeedsSignature>("/api/send/confirm", { intentId: intent.id, approve: true }),
      );
      patch(msgId, { state: "done" });
      if (res.mock) {
        say(`Sent ${usdc(intent.amount)} to ${intent.to.name}. Reference ${res.activity.txRef} (mock — nothing was broadcast).`);
      } else {
        say(`Sent ${usdc(intent.amount)} to ${intent.to.name} on Stellar testnet.`, undefined, res.activity.explorerUrl);
      }
      void refresh();
    } catch (e) {
      const err = e as ClientApiError;
      patch(msgId, { state: "error" });
      say(err.message ?? "That didn't go through. Nothing was sent.", { type: "refused", code: err.code, title: "Not sent", lines: [] });
    }
  }

  async function cancel(msgId: string, card: AgentCard) {
    patch(msgId, { state: "cancelled" });
    if (card.type === "quote") await api("/api/swap/cancel", { quoteId: card.quote.id }).catch(() => {});
    if (card.type === "send") await api("/api/send/cancel", { intentId: card.intent.id }).catch(() => {});
    if (card.type === "site-action") await api("/api/sites/cancel", { actionId: card.action.id }).catch(() => {});
    say(card.type === "site-action" ? "Cancelled. Nothing was signed." : "Cancelled. Nothing was sent.");
  }

  // Answer to "Connect to this site?"
  async function answerSite(msgId: string, request: SiteConnectRequest, connect: boolean, remember: boolean) {
    patch(msgId, { state: "busy" });
    setThinking(connect);
    try {
      const [reply] = await Promise.all([
        api<AgentReply>("/api/sites/respond", { requestId: request.id, connect, remember }),
        new Promise((r) => setTimeout(r, connect ? 900 : 200)),
      ]);
      patch(msgId, { state: connect ? "done" : "cancelled" });
      setMsgs((m) => [...m, { id: uid(), role: "agent", text: reply.text, card: reply.card, state: "pending", prompt: request.want ? `Connect to ${request.host} and buy ${request.want}` : `Connect to ${request.host}` }]);
    } catch (e) {
      const err = e as ClientApiError;
      patch(msgId, { state: connect ? "done" : "cancelled" });
      say(err.message ?? "That didn't work. Nothing was sent.", { type: "refused", code: err.code, title: "Not connected", lines: [] });
    } finally {
      setThinking(false);
    }
  }

  async function approveSite(msgId: string, action: SiteAction) {
    patch(msgId, { state: "busy" });
    try {
      const res = await api<{ activity: { txRef?: string }; mock: boolean }>("/api/sites/approve", { actionId: action.id, approve: true });
      patch(msgId, { state: "done" });
      say(`Signed. ${action.summary}. Reference ${res.activity.txRef}${res.mock ? " (mock — nothing was broadcast)" : ""}.`);
      void refresh();
    } catch (e) {
      const err = e as ClientApiError;
      patch(msgId, { state: "error" });
      say(err.message ?? "That didn't go through. Nothing was signed.", { type: "refused", code: err.code, title: "Not signed", lines: [] });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  const balanceLabel = data
    ? showNgn
      ? naira(data.balances.NGN)
      : `${usdcNumber(data.balances.USDC)} USDC`
    : "…";

  return (
    <div className="flex h-dvh flex-col bg-page">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-page/95 px-4 pb-2 pt-4 backdrop-blur-[2px] sm:px-6">
        <div className="mx-auto grid max-w-[720px] grid-cols-[1fr_auto_1fr] items-center">
          <Link href="/wallet" aria-label="Back to wallet" className="grid size-10 place-items-center rounded-full hover:bg-white">
            <BackIcon size={20} />
          </Link>
          <div className="text-center text-[19px] font-bold tracking-[-0.03em]">Wura</div>
          <div className="flex justify-end">
            <button
              onClick={() => setShowNgn((v) => !v)}
              className="nums rounded-full bg-[#E2E9F6] px-3.5 py-2 text-[13.5px] font-bold transition-colors hover:bg-white"
              title="Tap to switch currency"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={balanceLabel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="block">
                  {balanceLabel}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          <div suppressHydrationWarning className="py-3 text-center text-[12.5px] font-semibold uppercase tracking-[0.1em] text-soft">
            Today · {today}
          </div>

          {msgs.length === 0 && !thinking && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-5 py-10 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-blue text-white shadow-soft">
                <SparkIcon size={24} />
              </span>
              <div>
                <h1 className="text-[24px] font-bold tracking-[-0.03em]">What do you want to do?</h1>
                <p className="mx-auto mt-1.5 max-w-[420px] text-[14.5px] text-muted">
                  I compare rates, show you a preview, and only move money when you approve.{" "}
                  {data?.me.moneyMode === "testnet" ? "Stellar testnet: sends use test USDC." : "Example data, mock mode."}
                </p>
              </div>
            </motion.div>
          )}

          {msgs.map((m) =>
            m.role === "user" ? (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="ml-auto max-w-[85%] rounded-[22px] rounded-br-md bg-blue px-5 py-3 text-[16px] text-white"
              >
                {m.text}
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] bg-blue text-white">
                    <SparkIcon size={14} />
                  </span>
                  <div className="max-w-[85%] rounded-[22px] rounded-tl-md bg-white px-5 py-3 text-[16px] leading-snug shadow-[0_2px_10px_rgba(8,49,141,0.05)]">
                    {m.text}
                    {m.href && (
                      <a href={m.href} target="_blank" rel="noreferrer" className="mt-1.5 block text-[14px] font-semibold text-pink-deep underline underline-offset-2">
                        View the transaction on Stellar Expert ↗
                      </a>
                    )}
                  </div>
                </div>
                {m.card && (
                  <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="sm:ml-[42px]"
                  >
                    <CardFor
                      msg={m}
                      onApprove={(q) => approveQuote(m.id, q)}
                      onConfirm={(i) => confirmSend(m.id, i)}
                      onCancel={(c) => cancel(m.id, c)}
                      onRetry={() => m.prompt && send(m.prompt)}
                      onSay={send}
                      onSiteAnswer={(r, c, k) => answerSite(m.id, r, c, k)}
                      onSiteApprove={(a) => approveSite(m.id, a)}
                    />
                  </motion.div>
                )}
              </motion.div>
            ),
          )}

          {thinking && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2.5" aria-label="Wura is typing">
              <span className="grid size-8 place-items-center rounded-[10px] bg-blue text-white">
                <SparkIcon size={14} />
              </span>
              <div className="flex gap-1 rounded-[22px] rounded-tl-md bg-white px-5 py-4">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2 animate-blink rounded-full bg-blue/60" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 pt-1 sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-[720px]">
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={thinking}
                className="shrink-0 rounded-full bg-white px-4 py-2 text-[13.5px] font-semibold shadow-[0_2px_10px_rgba(8,49,141,0.06)] transition hover:-translate-y-0.5 hover:text-pink-deep disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-full bg-white p-2 pl-6 shadow-[0_8px_30px_rgba(8,49,141,0.08)]">
            <label htmlFor="chat-input" className="sr-only">Message Wura</label>
            <input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Wura"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-blue outline-none placeholder:text-soft"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim() || thinking}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-blue text-white transition hover:bg-blue-mid disabled:opacity-40"
            >
              <ArrowRightIcon size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function CardFor({
  msg,
  onApprove,
  onConfirm,
  onCancel,
  onRetry,
  onSay,
  onSiteAnswer,
  onSiteApprove,
}: {
  msg: Extract<Msg, { role: "agent" }>;
  onSiteAnswer: (r: SiteConnectRequest, connect: boolean, remember: boolean) => void;
  onSiteApprove: (a: SiteAction) => void;
  onApprove: (q: Quote) => void;
  onConfirm: (i: SendIntent) => void;
  onCancel: (c: AgentCard) => void;
  onRetry: () => void;
  onSay: (t: string) => void;
}) {
  const card = msg.card!;
  const state = msg.state ?? "pending";
  const shell = "rounded-card-lg p-6 shadow-[0_18px_40px_rgba(8,49,141,0.12)] sm:p-7";
  switch (card.type) {
    case "quote":
      return (
        <Card className={shell}>
          <QuoteCard quote={card.quote} state={state} onApprove={() => onApprove(card.quote)} onCancel={() => onCancel(card)} onRefresh={onRetry} />
        </Card>
      );
    case "send":
      return (
        <Card className={shell}>
          <SendCard intent={card.intent} state={state} onConfirm={() => onConfirm(card.intent)} onCancel={() => onCancel(card)} onRefresh={onRetry} />
        </Card>
      );
    case "link":
      return (
        <Card className={shell}>
          <LinkCard link={card.link} />
        </Card>
      );
    case "rates":
      return (
        <Card className={shell}>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-soft">
            Rates for {naira(card.quote.amountIn)} → USDC · {card.quote.source === "live" ? "live" : "example"}
          </div>
          <div className="mt-4">
            <RateRows venues={card.quote.venues} unit="USDC" />
          </div>
          {card.quote.unquoted.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 text-[13px] text-muted">
              {card.quote.unquoted.map((u) => (
                <span key={u.venue}>
                  {u.name} not compared: {u.reason.charAt(0).toLowerCase() + u.reason.slice(1)}.
                </span>
              ))}
            </div>
          )}
          <Button className="mt-5 w-full" variant="outline-blue" onClick={() => onSay(`Change ${naira(card.quote.amountIn)} to dollars`)}>
            Prepare this swap
          </Button>
        </Card>
      );
    case "balance":
      return (
        <Card className={cx(shell, "grid grid-cols-2 gap-4")}>
          <div>
            <div className="text-[12.5px] text-soft">Naira</div>
            <div className="nums text-[24px] font-bold tracking-[-0.03em]">{naira(card.balances.NGN)}</div>
          </div>
          <div>
            <div className="text-[12.5px] text-soft">USDC</div>
            <div className="nums text-[24px] font-bold tracking-[-0.03em]">{usdcNumber(card.balances.USDC)}</div>
          </div>
          <div className="col-span-2 rounded-2xl bg-mist p-4 text-[13.5px] text-muted">
            Left to spend today: <b className="text-blue">{naira(card.limits.remainingToday.NGN)}</b> and{" "}
            <b className="text-blue">{usdc(card.limits.remainingToday.USDC)}</b>. Example limits.
          </div>
        </Card>
      );
    case "site-permission":
      return (
        <Card className={shell}>
          <SitePermissionCard
            request={card.request}
            siteName={card.siteName}
            state={state}
            onAnswer={(c, k) => onSiteAnswer(card.request, c, k)}
          />
        </Card>
      );
    case "site-action":
      return (
        <Card className={shell}>
          <SiteActionCard
            action={card.action}
            state={state}
            onApprove={() => onSiteApprove(card.action)}
            onCancel={() => onCancel(card)}
            onRefresh={onRetry}
          />
        </Card>
      );
    case "refused":
      return (
        <div className="flex items-center gap-3 rounded-2xl bg-pink/12 px-5 py-3.5 text-[14px] font-semibold text-pink-deep">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-pink text-[13px] text-white">!</span>
          {card.title}. Nothing was sent.
        </div>
      );
  }
}
