"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { CashOutStatus, PartnerSignIn, RampCurrency, TopUpStatus } from "@/server/ramp/types";
import { useStellarHashSigner } from "./providers";
import { CheckIcon, ShieldIcon } from "./icons";
import { Button, Pill, cx } from "./ui";

/**
 * The pieces every live naira top-up and cash-out share (M6): signing in to
 * the partner, sending the user to the partner's own page, and following the
 * transfer's status when they come back. Nothing here moves money. A
 * cash-out's payment is approved and signed on the cash-out screen.
 */

export function isPartnerSignIn(v: unknown): v is PartnerSignIn {
  return typeof v === "object" && v !== null && (v as PartnerSignIn).status === "needs_partner_signin";
}

export type PartnerPage = { id: string; url: string; status: "open_partner_page" };
export function isPartnerPage(v: unknown): v is PartnerPage {
  return typeof v === "object" && v !== null && (v as PartnerPage).status === "open_partner_page" && typeof (v as PartnerPage).url === "string";
}

/**
 * Signs the partner's sign-in challenge with the user's wallet and hands it
 * back. The server checked the challenge before asking (it can only prove who
 * owns the wallet, it can't move money) and checks it again on the way back.
 */
export function usePartnerSignIn() {
  const signer = useStellarHashSigner();
  return useCallback(
    async (p: PartnerSignIn) => {
      if (!signer) throw new ClientApiError("SIGNING_UNAVAILABLE", "Signing in to the partner needs your Privy wallet, but Privy isn't configured.", 503);
      let signature: string;
      try {
        signature = await signer(p.address, p.hash);
      } catch {
        throw new ClientApiError("NOT_APPROVED", "Your wallet didn't sign, so the partner sign-in didn't happen. Nothing was sent.", 403);
      }
      await api("/api/funding/naira/signin", { receive: p.receive, challenge: p.challenge, signature });
    },
    [signer],
  );
}

const errText = (e: unknown, fallback: string) => (e instanceof ClientApiError ? e.message : fallback);

/** Explains the partner sign-in before the wallet is asked to sign it. */
export function PartnerSignInStep({ signIn, onSignedIn, onCancel }: { signIn: PartnerSignIn; onSignedIn: () => Promise<void> | void; onCancel?: () => void }) {
  const sign = usePartnerSignIn();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    setBusy(true);
    try {
      await sign(signIn);
      await onSignedIn();
    } catch (e) {
      setErr(errText(e, "Couldn't sign in to the partner. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><ShieldIcon size={20} /></span>
        <div className="text-[18px] font-bold tracking-[-0.02em]">Sign in to the partner</div>
      </div>
      <p className="text-[14px] leading-relaxed text-muted">
        The partner needs proof that this wallet is yours. Your wallet signs a sign-in message. It can&apos;t move money, and we checked it before asking.
        It lasts about a day.
      </p>
      {err && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{err}</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="blue" size="lg" onClick={go} disabled={busy}>{busy ? "Signing in…" : "Sign in with my wallet"}</Button>
        {onCancel && <Button variant="ghost" size="lg" onClick={onCancel} disabled={busy}>Back</Button>}
      </div>
    </div>
  );
}

/**
 * Sends the user to the partner's page. A link, not window.open after an
 * await, which browsers block as a pop-up.
 */
export function PartnerPageStep({ url, kind, onReturned }: { url: string; kind: "topup" | "cashout"; onReturned: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-relaxed text-muted">
        {kind === "topup"
          ? "Finish on the partner's page. It checks your identity and shows the bank transfer to make. Come back here when you're done."
          : "On the partner's page, enter the bank account to pay. Then come back here to approve the payment from your wallet. Nothing leaves your wallet until you approve it here."}
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          className={cx("inline-flex h-12 items-center justify-center rounded-full px-7 text-[15px] font-semibold transition", opened ? "bg-blue/[0.06] text-blue" : "bg-blue text-white shadow-soft hover:bg-blue-mid")}
        >
          {opened ? "Open the partner's page again" : "Open the partner's page"}
        </a>
        {opened && <Button size="lg" onClick={onReturned}>I&apos;ve finished there</Button>}
      </div>
    </div>
  );
}

type Status = (TopUpStatus | CashOutStatus) & { kind: "topup" | "cashout" };
const ENDED = (s: Status | null) => s?.state === "done" || s?.state === "failed";

/**
 * Follows one live transfer: reads its status now, whenever the tab comes back
 * into view, and every 20 seconds while it's visible. Stops once it has ended.
 * The server writes the history entry when a transfer ends; this never logs.
 */
export function useTransferStatus(t: { kind: "topup" | "cashout"; id: string; currency: RampCurrency } | null) {
  // Tagged with the transfer it belongs to, so switching transfers never shows the old one.
  const [read, setRead] = useState<{ key: string; status: Status } | null>(null);
  const [signIn, setSignIn] = useState<PartnerSignIn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef<Status | null>(null);
  const key = t ? `${t.kind}:${t.currency}:${t.id}` : "";

  const refresh = useCallback(async () => {
    if (!t || ENDED(latest.current)) return;
    const path =
      t.kind === "topup"
        ? `/api/funding/naira/status?id=${encodeURIComponent(t.id)}&receive=${t.currency}`
        : `/api/funding/naira/cashout?id=${encodeURIComponent(t.id)}&from=${t.currency}`;
    try {
      const r = await api<TopUpStatus | CashOutStatus | PartnerSignIn>(path);
      if (isPartnerSignIn(r)) {
        setSignIn(r);
        return;
      }
      setSignIn(null);
      setErr(null);
      latest.current = { ...r, kind: t.kind };
      setRead({ key, status: latest.current });
    } catch (e) {
      setErr(errText(e, "Couldn't reach the partner. We'll check again."));
    }
    // `key` stands for `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    latest.current = null;
    if (!key) return;
    // Subscribing to an outside system (the partner): its answer arrives after a network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onShow = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    const timer = window.setInterval(onShow, 20_000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      window.clearInterval(timer);
    };
  }, [key, refresh]);

  return { status: read?.key === key ? read.status : null, signIn, err, refresh };
}

const STATE: Record<Status["state"], { label: string; tone: "blue" | "pink" | "pink-solid" }> = {
  waiting_for_you: { label: "Waiting for you", tone: "pink" },
  processing: { label: "Processing", tone: "blue" },
  done: { label: "Done", tone: "blue" },
  failed: { label: "Didn't go through", tone: "pink-solid" },
};

/** One transfer's state, in the partner's plain message. */
export function TransferStatusCard({ status, id }: { status: Status | null; id: string }) {
  if (!status) return <p className="text-[14px] text-muted">Checking with the partner…</p>;
  const s = STATE[status.state];
  const amount = status.kind === "topup" ? (status as TopUpStatus).received : (status as CashOutStatus).send;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-mist p-5">
      <div className="flex items-center gap-2">
        {status.state === "done" && <CheckIcon size={16} />}
        <Pill tone={s.tone}>{s.label}</Pill>
        {amount !== null && <span className="nums ml-auto text-[15px] font-bold">{money(amount, status.currency)}</span>}
      </div>
      <p className="text-[14px] leading-relaxed">{status.message}</p>
      <p className="text-[12px] text-soft">Reference: <span className="font-mono">{id}</span></p>
    </div>
  );
}
