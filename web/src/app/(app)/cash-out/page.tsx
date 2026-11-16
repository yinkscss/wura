"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BankIcon, CheckIcon, OutIcon } from "@/components/icons";
import { PartnerNote } from "@/components/partner-note";
import {
  isPartnerPage,
  isPartnerSignIn,
  PartnerPageStep,
  PartnerSignInStep,
  TransferStatusCard,
  useTransferStatus,
} from "@/components/partner-flow";
import { useStellarHashSigner } from "@/components/providers";
import { Button, Card, Pill, cx } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { api, ClientApiError } from "@/lib/api";
import { money, naira, shortAddress, usdcNumber } from "@/lib/format";
import type { Activity, NeedsSignature, SendIntent } from "@/lib/types";
import type { CashOutPreview, PartnerSignIn, RampCurrency, RampInfo } from "@/server/ramp/types";

/**
 * Cash out to a naira bank account (M6). The user starts on Wura, enters the
 * bank account on the partner's page, then approves the payment here. The
 * payment goes through the same approval, caps, signature and log as a send;
 * the server reads the partner again before approving and before submitting.
 */

/** Customer wording: naira as ₦, dollars as $. No token names. */
const show = (minor: number, c: RampCurrency) => (c === "NGN" ? naira(minor) : `$${usdcNumber(minor)}`);
const errText = (e: unknown, fallback: string) => (e instanceof ClientApiError ? e.message : fallback);

type Live = { id: string; from: RampCurrency; amount: number | null; url: string | null };
type Stored = { id: string; kind: "topup" | "cashout"; currency: RampCurrency; amount: number; state: string; message: string; startedAt: number };

export default function CashOutPage() {
  const [info, setInfo] = useState<RampInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [preview, setPreview] = useState<CashOutPreview | null>(null);

  useEffect(() => {
    api<RampInfo>("/api/funding/naira/info").then(setInfo, (e) => setInfoErr(errText(e, "Couldn't load cash-out limits.")));
  }, []);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Cash out" sub="Send money from your wallet to a Nigerian bank account, through a partner." />
      {infoErr && <Card className="p-5 text-[14px] text-pink-deep">{infoErr}</Card>}
      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        <Card className="p-6 shadow-soft sm:p-8">
          {!info ? (
            <SkeletonBlock className="h-72" />
          ) : live ? (
            <LiveCashOut key={live.id} live={live} onRestart={() => setLive(null)} />
          ) : preview ? (
            <MockPreview preview={preview} onBack={() => setPreview(null)} />
          ) : (
            <StartForm info={info} onLive={setLive} onPreview={setPreview} />
          )}
        </Card>
        <Card className="h-fit p-6 shadow-soft sm:p-7">
          <h2 className="text-[20px] font-bold tracking-[-0.03em]">Recent</h2>
          <p className="mb-4 mt-1 text-[13.5px] text-muted">Your top-ups and cash-outs with the partner.</p>
          {info?.live ? <Recent onResume={setLive} /> : <p className="text-[13.5px] text-muted">In the preview nothing reaches a partner, so there’s nothing to list.</p>}
        </Card>
      </div>
    </div>
  );
}

function StartForm({ info, onLive, onPreview }: { info: RampInfo; onLive: (l: Live) => void; onPreview: (p: CashOutPreview) => void }) {
  const [from, setFrom] = useState<RampCurrency>(info.options[0].currency);
  const option = info.options.find((o) => o.currency === from) ?? info.limits;
  const { enabled, min, max } = option.cashOut;
  const [amount, setAmount] = useState("");
  const minor = Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100) || 0;
  const outOfRange = (min !== null && minor < min) || (max !== null && minor > max);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<PartnerSignIn | null>(null);

  async function begin() {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<unknown>("/api/funding/naira/cashout", { amount: minor, from });
      if (isPartnerSignIn(r)) return setSignIn(r);
      setSignIn(null);
      if (isPartnerPage(r)) return onLive({ id: r.id, from, amount: minor, url: r.url });
      if (typeof r === "object" && r !== null && "receive" in r) return onPreview(r as CashOutPreview);
      setErr("The partner answered in a way we didn't expect, so nothing was started. Try again.");
    } catch (e) {
      setErr(errText(e, "Couldn't start the cash-out. Nothing was sent."));
    } finally {
      setBusy(false);
    }
  }

  if (signIn) return <PartnerSignInStep signIn={signIn} onSignedIn={begin} onCancel={() => setSignIn(null)} />;

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void begin();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><OutIcon size={20} /></span>
        <div className="text-[18px] font-bold tracking-[-0.02em]">To your bank account</div>
        {!info.live && <Pill tone="pink" className="ml-auto">Preview</Pill>}
      </div>
      {info.options.length > 1 && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-mist p-1.5" role="radiogroup" aria-label="What leaves your wallet">
          {info.options.map((o) => (
            <button
              type="button"
              role="radio"
              aria-checked={o.currency === from}
              key={o.currency}
              onClick={() => setFrom(o.currency)}
              className={cx("rounded-xl px-3 py-2.5 text-[13.5px] font-semibold", o.currency === from ? "bg-white shadow-soft" : "text-muted hover:text-blue")}
            >
              {o.currency === "NGN" ? "From my naira" : "From my dollars"}
            </button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Amount to send from your wallet</span>
        <div className="flex h-16 items-center rounded-2xl bg-mist px-5 focus-within:bg-white focus-within:shadow-[inset_0_0_0_1.5px_var(--color-pink)]">
          <span className="text-[28px] font-bold text-soft">{from === "NGN" ? "₦" : "$"}</span>
          <input
            inputMode="numeric"
            value={amount}
            placeholder="0"
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(0, 9);
              setAmount(d ? Number(d).toLocaleString("en-NG") : "");
            }}
            className="nums w-full bg-transparent px-2 text-[28px] font-bold tracking-[-0.03em] text-blue outline-none placeholder:text-soft"
            aria-label="Amount"
          />
        </div>
      </label>
      <p className="text-[13px] text-muted">
        {min !== null && <>Smallest cash-out: {show(min, from)}. </>}
        {max !== null && <>Most per cash-out: {show(max, from)}. </>}
        The bank account always receives naira. The partner shows its fee and rate on its page.
      </p>
      {minor > 0 && outOfRange && (
        <p className="text-[13.5px] font-medium text-pink-deep" role="alert">
          {min !== null && minor < min ? `The smallest cash-out is ${show(min, from)}.` : `Each cash-out is capped at ${show(max ?? 0, from)}.`}
        </p>
      )}
      {err && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{err}</p>}
      <PartnerNote kind="naira" />
      <Button type="submit" variant="blue" size="lg" disabled={busy || !enabled || minor <= 0 || outOfRange}>
        {busy ? "Starting…" : info.live ? "Continue to the partner" : "See an example"}
      </Button>
      <p className="text-[12.5px] text-soft">Nothing leaves your wallet until you approve the payment on this screen.</p>
    </form>
  );
}

/** The mock answers with an example only. */
function MockPreview({ preview, onBack }: { preview: CashOutPreview; onBack: () => void }) {
  const rows: Array<[string, string]> = [
    ["From your wallet", naira(preview.amount)],
    ["Partner fee", naira(preview.fee)],
    ["To your bank", naira(preview.receive)],
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><BankIcon size={20} /></span>
        <div className="text-[18px] font-bold tracking-[-0.02em]">Example cash-out</div>
        <Pill tone="pink" className="ml-auto">Preview</Pill>
      </div>
      <dl className="divide-y divide-line rounded-2xl bg-mist px-5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-3.5">
            <dt className="text-[13.5px] text-muted">{k}</dt>
            <dd className="nums text-right text-[15px] font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-2xl bg-pink/12 p-4 text-[13.5px] font-medium leading-relaxed text-pink-deep">
        This is an example. In the preview no partner is connected, so nothing is sent and nothing is logged.
      </p>
      <Button variant="ghost" size="lg" onClick={onBack}>Back</Button>
    </div>
  );
}

type Submitted = { status: "done"; hash: string; activity: Activity };
/** The step to repeat once the partner sign-in is renewed. A signed payment is retried with the same signature. */
type Resume = "review" | "approve" | { txId: string; signature: string };

/** A live cash-out: the partner's page, its status, then the payment from the wallet once the partner is ready. */
function LiveCashOut({ live, onRestart }: { live: Live; onRestart: () => void }) {
  const [returned, setReturned] = useState(live.url === null);
  const { status, signIn, err, refresh } = useTransferStatus(returned ? { kind: "cashout", id: live.id, currency: live.from } : null);
  const [intent, setIntent] = useState<SendIntent | null>(null);
  const [sent, setSent] = useState<Submitted | null>(null);
  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [renew, setRenew] = useState<{ signIn: PartnerSignIn; then: Resume } | null>(null);
  const signer = useStellarHashSigner();
  const ready = status?.kind === "cashout" && "readyToPay" in status && status.readyToPay && status.state === "waiting_for_you";

  async function review() {
    setPayErr(null);
    setBusy(true);
    try {
      const r = await api<SendIntent | PartnerSignIn>("/api/funding/naira/cashout/pay", { id: live.id, from: live.from });
      if (isPartnerSignIn(r)) return setRenew({ signIn: r, then: "review" });
      setIntent(r);
    } catch (e) {
      setPayErr(errText(e, "Couldn't get the payment details from the partner. Nothing was sent."));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!intent) return;
    setPayErr(null);
    setBusy(true);
    try {
      const n = await api<NeedsSignature | PartnerSignIn>("/api/funding/naira/cashout/approve", { intentId: intent.id, approve: true });
      if (isPartnerSignIn(n)) return setRenew({ signIn: n, then: "approve" });
      if (!signer) throw new ClientApiError("SIGNING_UNAVAILABLE", "This payment needs your Privy wallet, but Privy isn't configured.", 503);
      let signature: string;
      try {
        signature = await signer(n.address, n.hash);
      } catch {
        throw new ClientApiError("NOT_APPROVED", "Your wallet didn't sign, so nothing was sent.", 403);
      }
      await submit({ txId: n.txId, signature });
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  async function submit(signed: { txId: string; signature: string }) {
    const r = await api<Submitted | PartnerSignIn>("/api/funding/naira/cashout/submit", signed);
    if (isPartnerSignIn(r)) return setRenew({ signIn: r, then: signed });
    setSent(r);
    setIntent(null);
    void refresh();
  }

  function failed(e: unknown) {
    const code = e instanceof ClientApiError ? e.code : null;
    // The partner changed something, or the preview is stale: start the review again from fresh numbers.
    if (code === "CHANGED" || code === "QUOTE_EXPIRED" || code === "NOT_READY" || code === "ALREADY_USED") setIntent(null);
    setPayErr(errText(e, "The payment didn't go through. Nothing was sent."));
  }

  /** After the new partner sign-in: the same step again. Errors show here, not on the sign-in step. */
  async function resume(then: Resume) {
    setRenew(null);
    if (then === "review") return review();
    if (then === "approve") return approve();
    setPayErr(null);
    setBusy(true);
    try {
      await submit(then);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><BankIcon size={20} /></span>
        <div className="text-[18px] font-bold tracking-[-0.02em]">
          Cash-out{live.amount !== null ? ` of ${show(live.amount, live.from)}` : ""}
        </div>
      </div>

      {live.url && !sent && <PartnerPageStep url={live.url} kind="cashout" onReturned={() => (returned ? void refresh() : setReturned(true))} />}

      {returned && signIn && <PartnerSignInStep signIn={signIn} onSignedIn={refresh} />}

      {renew && !signIn && (
        <div className="flex flex-col gap-3">
          <p className="rounded-2xl bg-pink/12 p-4 text-[13.5px] font-medium leading-relaxed text-pink-deep">
            {typeof renew.then === "object"
              ? "Your sign-in with the partner expired before the payment went out. Sign in again and we'll send the payment you already approved. Nothing was sent yet."
              : "Your sign-in with the partner has expired. Sign in again to carry on. Nothing was sent."}
          </p>
          <PartnerSignInStep signIn={renew.signIn} onSignedIn={() => resume(renew.then)} onCancel={() => setRenew(null)} />
        </div>
      )}

      {returned && !signIn && !renew && (
        <>
          <TransferStatusCard status={status} id={live.id} />
          {err && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{err}</p>}

          {sent && (
            <div className="flex items-start gap-3 rounded-2xl bg-blue/[0.06] p-4 text-[14px]">
              <CheckIcon size={18} />
              <div>
                <div className="font-semibold">Sent to the partner.</div>
                <div className="text-muted">The partner now pays your bank account. This page updates as it goes.</div>
                {sent.activity.explorerUrl && (
                  <a href={sent.activity.explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold underline underline-offset-2">
                    See the payment on Stellar
                  </a>
                )}
              </div>
            </div>
          )}

          {ready && !sent && !intent && (
            <div className="flex flex-col gap-3 rounded-2xl bg-pink/12 p-4">
              <p className="text-[14px] font-medium text-pink-deep">The partner is ready. Review the payment, then approve it from your wallet.</p>
              <Button variant="blue" size="lg" onClick={review} disabled={busy}>{busy ? "Checking with the partner…" : "Review the payment"}</Button>
            </div>
          )}

          {intent && !sent && <PaymentReview intent={intent} busy={busy} onApprove={approve} onCancel={() => setIntent(null)} />}

          {payErr && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{payErr}</p>}

          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" size="lg" onClick={() => void refresh()}>Check again</Button>
            <Button variant="ghost" size="lg" onClick={onRestart}>Start another</Button>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentReview({ intent, busy, onApprove, onCancel }: { intent: SendIntent; busy: boolean; onApprove: () => void; onCancel: () => void }) {
  const fee = intent.cashOut?.fee ?? null;
  const receive = intent.cashOut?.receive ?? null;
  const rows: Array<[string, string]> = [
    ["Leaves your wallet", money(intent.amount, intent.asset)],
    ...(fee !== null ? [["Partner fee", money(fee, intent.asset)] as [string, string]] : []),
    ...(receive !== null ? [["Reaches your bank", money(receive.amount, receive.currency)] as [string, string]] : []),
    ["To", `The partner · ${shortAddress(intent.to.address)}`],
    ["Payment reference", intent.memo ? (intent.memo.value.length > 20 ? `${intent.memo.value.slice(0, 8)}…${intent.memo.value.slice(-6)}` : intent.memo.value) : "None"],
    ["Left today after this", money(Math.max(0, intent.dailyRemainingAfter), intent.asset)],
  ];
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line p-5">
      <div className="text-[16px] font-bold">Approve this payment</div>
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-3">
            <dt className="text-[13.5px] text-muted">{k}</dt>
            <dd className="nums text-right text-[14.5px] font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12.5px] leading-relaxed text-soft">
        The partner set the amount and the reference for your cash-out.
        {receive === null && " It shows what reaches your bank, after its fee, on its own page."} We check them with the partner again before sending, and send
        nothing if they changed.
      </p>
      <PartnerNote kind="send" />
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onApprove} disabled={busy}>{busy ? "Waiting for your wallet…" : "Approve and send"}</Button>
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={busy}>Not now</Button>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = { waiting_for_you: "Waiting for you", processing: "Processing", done: "Done", failed: "Didn't go through" };

/** Stored transfers, so a cash-out can be picked up after a restart or on another device. */
function Recent({ onResume }: { onResume: (l: Live) => void }) {
  const [rows, setRows] = useState<Stored[] | null>(null);
  useEffect(() => {
    api<{ transfers: Stored[] }>("/api/funding/naira/transfers").then((r) => setRows(r.transfers), () => setRows([]));
  }, []);
  if (!rows) return <SkeletonBlock className="h-40" />;
  if (rows.length === 0) return <p className="text-[13.5px] text-muted">Nothing yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.slice(0, 8).map((t) => {
        const open = t.state === "waiting_for_you" || t.state === "processing";
        return (
          <li key={`${t.kind}:${t.id}`} className="flex flex-col gap-1 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold">{t.kind === "topup" ? "Top-up" : "Cash-out"}</span>
              <span className="nums text-[14px] font-bold">{show(t.amount, t.currency)}</span>
              <Pill tone={t.state === "failed" ? "pink-solid" : t.state === "done" ? "blue" : "pink"} className="ml-auto">{STATE_LABEL[t.state] ?? t.state}</Pill>
            </div>
            <p className="text-[12.5px] leading-snug text-muted">{t.message}</p>
            {open && t.kind === "cashout" && (
              <button onClick={() => onResume({ id: t.id, from: t.currency, amount: t.amount, url: null })} className="self-start text-[13px] font-semibold text-blue underline underline-offset-2">
                Continue this cash-out
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
