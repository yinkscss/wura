"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ClientApiError } from "@/lib/api";
import { naira } from "@/lib/format";
import { BackIcon, BankIcon, ChatIcon, CheckIcon, CopyIcon, IdIcon, WalletIcon } from "@/components/icons";
import { copyText } from "@/components/money-cards";
import { PartnerNote } from "@/components/partner-note";
import { Starfield } from "@/components/starfield";
import type { RampInfo } from "@/server/ramp/types";
import { Button, ButtonLink, Card, Pill, Wordmark, buttonClass, cx } from "@/components/ui";

type View = "choose" | "usdc" | "naira-verify" | "naira-amount" | "naira-transfer" | "done";

type Order = {
  id: string;
  amount: number;
  transfer: { bank: string; accountNumber: string; accountName: string; reference: string };
};

/** Only the mock answers with bank details to pay. A live partner answers with a sign-in or a page to open. */
function isMockOrder(o: unknown): o is Order {
  return typeof o === "object" && o !== null && "transfer" in o && typeof (o as Order).transfer?.accountNumber === "string";
}

const ease = [0.22, 1, 0.36, 1] as const;

export function Onboarding() {
  const [view, setView] = useState<View>("choose");
  const [doneVia, setDoneVia] = useState<"usdc" | "naira">("usdc");
  const [order, setOrder] = useState<Order | null>(null);
  // Limits and the identity-check mode come from the naira partner, not from this file.
  const [ramp, setRamp] = useState<RampInfo | null>(null);
  useEffect(() => {
    api<RampInfo>("/api/funding/naira/info").then(setRamp, () => setRamp(null));
  }, []);

  const step = view === "choose" ? 1 : view === "done" ? 3 : 2;
  const label =
    view === "choose" ? "Funding" : view === "usdc" ? "Add USDC" : view === "done" ? "Try it" : "Naira top-up";

  return (
    <div className="hero-sky relative min-h-dvh overflow-hidden text-white">
      <Starfield arc interactive fadeFrom={0.5} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_28%,rgba(90,170,255,0.35),transparent_70%)]" />

      <header className="relative z-10 flex items-center justify-between px-5 py-6 sm:px-12">
        <Wordmark href="/wallet" />
        {view !== "done" && (
          <Link href="/wallet" className={buttonClass("outline", "sm")}>
            Skip for now
          </Link>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-[1100px] px-5 pb-24 sm:px-8">
        <div className="text-center">
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/80"
          >
            Step {step} of 3 · {label}
          </motion.div>
          <div className="mx-auto mt-3 flex w-40 gap-1.5" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <span key={n} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                <motion.span
                  className="block h-full rounded-full bg-white"
                  initial={false}
                  animate={{ width: n <= step ? "100%" : "0%" }}
                  transition={{ duration: 0.5, ease }}
                />
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {view === "choose" && (
            <Panel key="choose">
              <Headline title="How do you want to start?">
                You can add the other method later. USDC needs no identity check. Naira top-ups go through an identity check first.
              </Headline>
              <div className="mt-10 grid gap-6 md:grid-cols-2">
                <ChoiceCard
                  highlight
                  pill={<Pill tone="pink">No ID required</Pill>}
                  title="Fund with USDC"
                  body="Send USDC to your Wura wallet and start chatting. Swaps, sends, payment links and balances work straight away."
                  points={["No identity check to start", "Swap to naira later, when you want", "Spending limits apply from the first send"]}
                  action={<Button size="lg" className="w-full" onClick={() => setView("usdc")}>Start with USDC</Button>}
                  delay={0.05}
                />
                <ChoiceCard
                  pill={<Pill tone="blue">Identity check required</Pill>}
                  title="Fund with naira"
                  body="Top up by bank transfer. You’ll verify your ID before the first naira deposit."
                  points={["Bank transfer on-ramp", "Identity check before the first naira top-up", "Small trial limits while this is new"]}
                  action={<Button variant="blue" size="lg" className="w-full" onClick={() => setView(ramp?.identityCheck === "partner_page" ? "naira-amount" : "naira-verify")}>Continue with naira</Button>}
                  delay={0.12}
                />
              </div>
            </Panel>
          )}

          {view === "usdc" && (
            <Panel key="usdc">
              <UsdcPanel
                onBack={() => setView("choose")}
                onDone={() => {
                  setDoneVia("usdc");
                  setView("done");
                }}
              />
            </Panel>
          )}

          {view === "naira-verify" && (
            <Panel key="nv">
              <NairaVerify onBack={() => setView("choose")} onVerified={() => setView("naira-amount")} />
            </Panel>
          )}

          {view === "naira-amount" && (
            <Panel key="na">
              <NairaAmount
                ramp={ramp}
                onBack={() => setView("choose")}
                onOrder={(o) => {
                  setOrder(o);
                  setView("naira-transfer");
                }}
              />
            </Panel>
          )}

          {view === "naira-transfer" && order && (
            <Panel key="nt">
              <NairaTransfer
                order={order}
                onDone={() => {
                  setDoneVia("naira");
                  setView("done");
                }}
              />
            </Panel>
          )}

          {view === "done" && (
            <Panel key="done">
              <Headline title="You’re set.">
                {doneVia === "usdc"
                  ? "Once USDC lands at your address, ask Wura for anything. Example balances are loaded so you can try every flow now."
                  : "When the transfer clears, your naira shows up in the wallet. Example balances are loaded so you can try every flow now."}
              </Headline>
              <div className="mx-auto mt-10 grid max-w-[760px] gap-5 sm:grid-cols-2">
                <Card className="flex flex-col gap-4 p-7 text-blue">
                  <span className="grid size-11 place-items-center rounded-2xl bg-pink/20 text-pink-deep"><ChatIcon size={20} /></span>
                  <div>
                    <h3 className="text-[20px] font-bold tracking-[-0.03em]">Talk to Wura</h3>
                    <p className="mt-1 text-[14.5px] text-muted">Try “Change ₦50,000 to dollars”.</p>
                  </div>
                  <ButtonLink href="/chat" size="lg" className="mt-auto w-full">Open chat</ButtonLink>
                </Card>
                <Card className="flex flex-col gap-4 p-7 text-blue">
                  <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><WalletIcon size={20} /></span>
                  <div>
                    <h3 className="text-[20px] font-bold tracking-[-0.03em]">See your wallet</h3>
                    <p className="mt-1 text-[14.5px] text-muted">Balances, limits and the transaction log.</p>
                  </div>
                  <ButtonLink href="/wallet" variant="blue" size="lg" className="mt-auto w-full">Go to wallet</ButtonLink>
                </Card>
              </div>
            </Panel>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45, ease }}
      className="mt-6"
    >
      {children}
    </motion.section>
  );
}

function Headline({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-center">
      <h1 className="text-balance text-[40px] font-bold leading-[1.02] tracking-[-0.045em] sm:text-[64px]">{title}</h1>
      <p className="mx-auto mt-4 max-w-[560px] text-[16.5px] leading-relaxed text-white/85">{children}</p>
    </div>
  );
}

function ChoiceCard({
  pill,
  title,
  body,
  points,
  action,
  highlight,
  delay,
}: {
  pill: ReactNode;
  title: string;
  body: string;
  points: string[];
  action: ReactNode;
  highlight?: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease }}
      whileHover={{ y: -6 }}
      className={cx(
        "flex flex-col rounded-card-lg bg-white p-7 text-blue shadow-deep sm:p-9",
        highlight && "shadow-[0_20px_40px_rgba(0,0,0,0.3),inset_0_0_0_2px_var(--color-pink)]",
      )}
    >
      <div>{pill}</div>
      <h2 className="mt-5 text-[30px] font-bold tracking-[-0.04em] sm:text-[34px]">{title}</h2>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">{body}</p>
      <ul className="mt-6 flex flex-col gap-3.5">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-3 text-[15.5px] font-medium">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mist text-blue"><CheckIcon size={13} /></span>
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-10 pt-2 sm:mt-auto sm:pt-14">{action}</div>
    </motion.div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-blue">
      <BackIcon size={14} /> Back to choices
    </button>
  );
}

function UsdcPanel({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<{ address: string; network: string; mock: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ address: string; network: string; mock: boolean }>("/api/funding/usdc").then(setInfo, (e) => setErr(e.message));
  }, []);
  return (
    <div className="mx-auto max-w-[620px]">
      <Headline title="Send USDC to your wallet">No ID needed. Use any Stellar wallet or exchange that sends USDC on Stellar.</Headline>
      <Card className="mt-10 flex flex-col gap-6 rounded-card-lg p-7 text-blue shadow-deep sm:p-9">
        <BackLink onClick={onBack} />
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-soft">Your Stellar address</div>
          <div className="mt-3 break-all rounded-2xl bg-mist px-5 py-4 font-mono text-[15px] font-semibold leading-relaxed tracking-wide">
            {info?.address ?? (err ? "—" : <span className="shimmer-bg animate-shimmer block h-12 rounded-lg" />)}
          </div>
          {err && <p className="mt-2 text-[13px] text-pink-deep">{err}</p>}
        </div>
        <Button
          variant="outline-blue"
          size="lg"
          disabled={!info}
          onClick={async () => {
            if (info && (await copyText(info.address))) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied ? "Copied" : "Copy address"}
        </Button>
        <ul className="flex flex-col gap-2 text-[14px] text-muted">
          <li>· Send <b className="text-blue">USDC on Stellar</b> only. Other networks won’t arrive.</li>
          <li>· No memo is needed for your own wallet.</li>
          {info?.mock && <li>· Mock mode: this address isn’t watched yet, and the balances you’ll see are examples.</li>}
          {info && <li>· Network: {info.network === "public" ? "Stellar mainnet" : "Stellar testnet"}</li>}
        </ul>
        <Button size="lg" onClick={onDone}>I’ve sent it — continue</Button>
      </Card>
    </div>
  );
}

function NairaVerify({ onBack, onVerified }: { onBack: () => void; onVerified: () => void }) {
  const [nin, setNin] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api("/api/funding/naira/verify", { nin: nin.replace(/\s/g, ""), consent });
      onVerified();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : "Couldn't check that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[620px]">
      <Headline title="Verify your identity">Required before your first naira deposit. USDC never needs this.</Headline>
      <Card className="mt-10 rounded-card-lg p-7 text-blue shadow-deep sm:p-9">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <BackLink onClick={onBack} />
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><IdIcon size={20} /></span>
            <div>
              <div className="text-[18px] font-bold tracking-[-0.02em]">National Identification Number</div>
              <div className="text-[13.5px] text-muted">11 digits, on your NIN slip or the NIMC app</div>
            </div>
          </div>
          <input
            id="nin"
            inputMode="numeric"
            autoComplete="off"
            value={nin}
            onChange={(e) => setNin(e.target.value.replace(/[^\d ]/g, "").slice(0, 14))}
            placeholder="00000000000"
            className="nums h-14 rounded-2xl bg-mist px-5 text-[20px] font-bold tracking-[0.18em] text-blue outline-none placeholder:text-soft/60 focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--color-pink)]"
          />
          <label className="flex cursor-pointer items-start gap-3 text-[14px] text-muted">
            <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[#08318D]" />
            I agree to an identity check by the naira on-ramp partner.
          </label>
          <div className="rounded-2xl bg-mist p-4 text-[13.5px] leading-relaxed text-muted">
            We keep only that your check passed, not your NIN. Our on-ramp partner may still ask for it on later top-ups until they confirm a past check can be reused.
          </div>
          {err && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{err}</p>}
          <Button type="submit" variant="blue" size="lg" disabled={busy || nin.replace(/\s/g, "").length !== 11 || !consent}>
            {busy ? "Checking…" : "Verify identity"}
          </Button>
          <p className="text-[12px] text-soft">Mock mode: the format is checked, but no real identity check runs.</p>
        </form>
      </Card>
    </div>
  );
}

const QUICK_AMOUNTS = [5_000, 10_000, 20_000, 50_000];

function NairaAmount({ ramp, onBack, onOrder }: { ramp: RampInfo | null; onBack: () => void; onOrder: (o: Order) => void }) {
  const { min, max } = ramp?.limits.topUp ?? { min: null, max: null };
  const quick = QUICK_AMOUNTS.filter((v) => (min === null || v * 100 >= min) && (max === null || v * 100 <= max));
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  // Start on the partner's minimum (or the first quick amount) until the user types.
  const start = min !== null ? Math.ceil(min / 100) : quick[0];
  const shown = touched ? amount : start ? start.toLocaleString("en-NG") : "";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minor = Math.round(Number(shown.replace(/[^\d.]/g, "")) * 100) || 0;
  const outOfRange = (min !== null && minor < min) || (max !== null && minor > max);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const o = await api<unknown>("/api/funding/naira/order", { amount: minor });
      if (!isMockOrder(o)) {
        setErr("Naira top-ups through the partner's own page aren't switched on in this screen yet. Nothing was charged.");
        return;
      }
      onOrder(o);
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : "Couldn't start the top-up. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[620px]">
      <Headline title="How much naira?">
        {ramp?.identityCheck === "partner_page" ? "The partner checks your identity on its own page." : "You’re verified."} While naira top-ups are new, each one has a small trial cap.
      </Headline>
      <Card className="mt-10 rounded-card-lg p-7 text-blue shadow-deep sm:p-9">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <BackLink onClick={onBack} />
          <PartnerNote kind="naira" />
          {ramp?.identityCheck !== "partner_page" && (
            <div className="flex items-center gap-2 text-[13px] font-semibold text-pink-deep">
              <CheckIcon size={15} /> Identity check passed
            </div>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Amount</span>
            <div className="flex h-16 items-center rounded-2xl bg-mist px-5 focus-within:bg-white focus-within:shadow-[inset_0_0_0_1.5px_var(--color-pink)]">
              <span className="text-[28px] font-bold text-soft">₦</span>
              <input
                id="amount"
                inputMode="numeric"
                value={shown}
                onChange={(e) => {
                  setTouched(true);
                  const d = e.target.value.replace(/\D/g, "").slice(0, 9);
                  setAmount(d ? Number(d).toLocaleString("en-NG") : "");
                }}
                className="nums w-full bg-transparent px-2 text-[28px] font-bold tracking-[-0.03em] text-blue outline-none"
              />
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            {quick.map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => {
                  setTouched(true);
                  setAmount(v.toLocaleString("en-NG"));
                }}
                className="rounded-full bg-mist px-4 py-2 text-[13px] font-semibold hover:bg-pink/15"
              >
                {naira(v * 100)}
              </button>
            ))}
          </div>
          {ramp && (
            <p className="text-[13px] text-muted">
              {min !== null && <>Smallest top-up: {naira(min)}. </>}
              {max !== null && <>Trial cap per top-up: {naira(max)}.</>}
            </p>
          )}
          {minor > 0 && outOfRange && (
            <p className="text-[13.5px] font-medium text-pink-deep" role="alert">
              {min !== null && minor < min ? `The smallest top-up is ${naira(min)}.` : `Each top-up is capped at ${naira(max ?? 0)} for now.`}
            </p>
          )}
          {err && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{err}</p>}
          <Button type="submit" variant="blue" size="lg" disabled={busy || !ramp || minor <= 0 || outOfRange}>
            {busy ? "Starting…" : "Get bank transfer details"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function NairaTransfer({ order, onDone }: { order: Order; onDone: () => void }) {
  const rows: Array<[string, string]> = [
    ["Amount", naira(order.amount)],
    ["Bank", order.transfer.bank],
    ["Account number", order.transfer.accountNumber],
    ["Account name", order.transfer.accountName],
    ["Reference", order.transfer.reference],
  ];
  return (
    <div className="mx-auto max-w-[620px]">
      <Headline title="Make the transfer">Pay from your bank app using these details. The reference matches the transfer to you.</Headline>
      <Card className="mt-10 flex flex-col gap-5 rounded-card-lg p-7 text-blue shadow-deep sm:p-9">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-blue/[0.07]"><BankIcon size={20} /></span>
          <div className="text-[18px] font-bold tracking-[-0.02em]">Bank transfer</div>
          <Pill tone="pink" className="ml-auto">Mock</Pill>
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
          These are mock details for the preview. Don’t send money to them. The live naira partner isn’t connected to this screen yet.
        </p>
        <Button size="lg" onClick={onDone}>Continue</Button>
      </Card>
    </div>
  );
}
