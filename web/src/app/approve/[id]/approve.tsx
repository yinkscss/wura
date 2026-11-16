"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { QuoteCard, SendCard, type CardState } from "@/components/money-cards";
import { useOverview } from "@/components/overview";
import { Button, ButtonLink, Card, Wordmark } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { api, ClientApiError } from "@/lib/api";
import { money, naira, usdc } from "@/lib/format";
import { useCompleteSigning } from "@/lib/signing";
import type { NeedsSignature, Quote, SendIntent } from "@/lib/types";

type Opened = { kind: "send"; intent: SendIntent } | { kind: "quote"; quote: Quote };
type Done = { activity: { txRef?: string; explorerUrl?: string }; mock: boolean };

const stateOf = (status: string): CardState =>
  status === "sent" || status === "approved" ? "done" : status === "cancelled" ? "cancelled" : "pending";

/**
 * Approval page for previews prepared in a chat app (Claude, ChatGPT).
 * The link carries no token: it only opens for the signed-in owner. Opening
 * it (POST /api/approve) rebuilds an expired preview with fresh checks, and
 * the card only shows Confirm once those fresh numbers are here.
 */
export function Approve({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { refresh } = useOverview();
  const completeSigning = useCompleteSigning();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [state, setState] = useState<CardState>("pending");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; href?: string } | null>(null);

  const open = useCallback(async () => {
    setErr(null);
    try {
      const o = await api<Opened>("/api/approve", { id });
      setOpened(o);
      setState(stateOf(o.kind === "send" ? o.intent.status : o.quote.status));
    } catch (e) {
      setOpened(null);
      setErr(e instanceof ClientApiError ? e.message : "Couldn't open this. Try again.");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open();
  }, [open]);

  async function confirmSend(intent: SendIntent) {
    setState("busy");
    setErr(null);
    try {
      const res = await completeSigning<Done>(
        await api<Done | NeedsSignature>("/api/send/confirm", { intentId: intent.id, approve: true }),
      );
      setState("done");
      setResult(
        res.mock
          ? { text: `Sent ${money(intent.amount, intent.asset)} to ${intent.to.name} (mock — nothing was broadcast).` }
          : { text: `Sent ${money(intent.amount, intent.asset)} to ${intent.to.name} on Stellar.`, href: res.activity.explorerUrl },
      );
      void refresh();
    } catch (e) {
      const ce = e as ClientApiError;
      setState("error");
      setErr(ce.message ?? "That didn't go through. Nothing was sent.");
    }
  }

  async function approveQuote(quote: Quote) {
    setState("busy");
    setErr(null);
    try {
      const res = await api<Done>("/api/swap/approve", { quoteId: quote.id, approve: true });
      setState("done");
      const got = quote.to === "USDC" ? usdc(quote.amountOut) : naira(quote.amountOut);
      setResult({ text: `Done. ${got} is in your wallet${res.mock ? " (mock — nothing was broadcast)" : ""}.` });
      void refresh();
    } catch (e) {
      const ce = e as ClientApiError;
      setState("error");
      setErr(ce.message ?? "That didn't go through. Nothing was swapped.");
    }
  }

  async function switchAccount() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    router.push(`/sign-in?next=${encodeURIComponent(`/approve/${id}`)}`);
  }

  async function cancel() {
    if (!opened) return;
    setState("cancelled");
    if (opened.kind === "send") await api("/api/send/cancel", { intentId: opened.intent.id }).catch(() => {});
    else await api("/api/swap/cancel", { quoteId: opened.quote.id }).catch(() => {});
  }

  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-7 px-5 py-8 sm:px-8 lg:py-10">
      <Wordmark tone="light" href="/wallet" />
      <PageHeader title="Approve" sub="Prepared in a chat app. Nothing moves until you confirm here." />
      <Card className="p-6 shadow-soft sm:p-7">
        {opened ? (
          opened.kind === "send" ? (
            <SendCard intent={opened.intent} state={state} onConfirm={() => confirmSend(opened.intent)} onCancel={cancel} onRefresh={open} />
          ) : (
            <QuoteCard quote={opened.quote} state={state} onApprove={() => approveQuote(opened.quote)} onCancel={cancel} onRefresh={open} />
          )
        ) : err ? (
          <div className="flex flex-col gap-4">
            <p className="text-[15px]">{err}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="blue" onClick={switchAccount}>Sign in with a different email</Button>
              <ButtonLink href="/chat" variant="outline-blue">Open Wura chat</ButtonLink>
            </div>
          </div>
        ) : (
          <SkeletonBlock className="h-72" />
        )}
        {opened && err && <p className="mt-4 text-[14px] text-pink-deep">{err}</p>}
        {result && (
          <p className="mt-4 text-[14.5px]">
            {result.text}{" "}
            {result.href && (
              <a href={result.href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                View on explorer
              </a>
            )}
          </p>
        )}
      </Card>
      {(state === "done" || state === "cancelled") && (
        <p className="text-center text-[14px] text-muted">
          {state === "done" ? "You can go back to your chat and ask “did it go through?”." : "Cancelled. Nothing was sent. You can close this page."}
        </p>
      )}
    </div>
  );
}
