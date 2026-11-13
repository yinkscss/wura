"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { SiteAction, SiteConnectRequest } from "@/lib/types";
import { usdcNumber } from "@/lib/format";
import { CheckIcon, ClockIcon, GlobeIcon, ShieldIcon } from "./icons";
import type { CardState } from "./money-cards";
import { Button, Eyebrow, Pill, cx } from "./ui";

export function SitePermissionCard({
  request,
  siteName,
  state,
  onAnswer,
}: {
  request: SiteConnectRequest;
  siteName: string;
  state: CardState;
  onAnswer: (connect: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(true);
  const live = state === "pending" || state === "busy" || state === "error";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue/[0.07]">
          <GlobeIcon size={20} />
        </span>
        <div className="min-w-0">
          <Eyebrow>Not on your allow list</Eyebrow>
          <div className="mt-1 text-[22px] font-bold tracking-[-0.03em]">Connect to this site?</div>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-muted">
            {request.host}
            {siteName !== request.host && <span className="font-medium"> · {siteName}</span>}
          </div>
        </div>
      </div>
      {request.want && (
        <div className="rounded-2xl bg-mist px-4 py-3 text-[14px] text-muted">
          You asked to: <b className="text-blue">buy {request.want}</b>
        </div>
      )}
      <ul className="flex flex-col gap-2 text-[14px] text-muted">
        <li className="flex gap-2"><CheckIcon size={15} className="mt-0.5 shrink-0 text-blue" /> Connecting lets Wura read the site and prepare a transaction.</li>
        <li className="flex gap-2"><ShieldIcon size={15} className="mt-0.5 shrink-0 text-blue" /> It doesn’t let Wura sign. You’ll still see a preview and approve every payment.</li>
      </ul>
      {live ? (
        <>
          <label className="flex cursor-pointer items-center gap-3 text-[14px] font-medium">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 accent-[#08318D]"
            />
            Add {request.host} to my allow list
          </label>
          <div className="grid grid-cols-[1fr_1.3fr] gap-3">
            <Button variant="outline-blue" size="lg" disabled={state === "busy"} onClick={() => onAnswer(false, false)}>
              Don’t connect
            </Button>
            <Button variant="blue" size="lg" disabled={state === "busy"} onClick={() => onAnswer(true, remember)}>
              {state === "busy" ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </>
      ) : (
        <div className={cx("rounded-full px-4 py-3 text-center text-sm font-semibold", state === "done" ? "bg-blue/[0.06]" : "bg-mist text-muted")}>
          {state === "done" ? "Connected" : "Not connected. Nothing was sent."}
        </div>
      )}
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

export function SiteActionCard({
  action,
  state,
  onApprove,
  onCancel,
  onRefresh,
}: {
  action: SiteAction;
  state: CardState;
  onApprove?: () => void;
  onCancel?: () => void;
  onRefresh?: () => void;
}) {
  const live = state === "pending" || state === "busy" || state === "error";
  const left = useCountdown(action.expiresAt, live);
  const expired = live && left === 0;
  const short = `${action.contract.address.slice(0, 4)}…${action.contract.address.slice(-4)}`;
  const usedPct = Math.min(100, ((action.dailyLimit - action.dailyRemainingAfter) / action.dailyLimit) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Eyebrow>{state === "done" ? "Signed" : "Signing preview · not signed yet"}</Eyebrow>
        <div className="mt-2 text-[15px] font-medium text-muted">You’d pay</div>
        <div className="nums mt-0.5 text-[40px] font-bold leading-none tracking-[-0.045em]">
          {usdcNumber(action.price)} <span className="text-pink-deep">USDC</span>
        </div>
        <div className="mt-2 text-[14px] text-muted">{action.summary}</div>
      </div>

      {/* Discovery trail */}
      <ol className="flex flex-col gap-0 rounded-2xl bg-mist p-4">
        {action.steps.map((st, i) => (
          <motion.li
            key={st.label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.12 }}
            className="relative flex gap-3 pb-3 last:pb-0"
          >
            {i < action.steps.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-line" />}
            <span className="relative z-10 grid size-[19px] shrink-0 place-items-center rounded-full bg-blue text-white">
              <CheckIcon size={11} />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold">{st.label}</div>
              <div className="truncate font-mono text-[11.5px] text-muted">{st.detail}</div>
            </div>
          </motion.li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Site" value={action.host} />
        <Field label="Contract" value={short} mono badge={action.contract.verified ? "Verified" : undefined} />
        <Field label="Calls" value={`${action.call.fn}(…)`} mono />
        <Field label="Fee (example)" value={`${usdcNumber(action.fee)} USDC`} />
        <Field label="Your balance" value={`${usdcNumber(action.balanceBefore)} USDC`} />
        <Field label="Total debit" value={`${usdcNumber(action.total)} USDC`} />
      </div>

      <details className="rounded-2xl bg-mist px-4 py-3 text-[13px] text-muted">
        <summary className="cursor-pointer font-semibold text-blue">Function arguments</summary>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
          {action.call.args.map((a) => (
            <li key={a.name} className="truncate">
              {a.name}: <span className="text-soft">{a.type}</span> = {a.value}
            </li>
          ))}
        </ul>
      </details>

      <div className="flex gap-3 rounded-2xl bg-mist p-4">
        <ClockIcon size={18} className="mt-0.5 shrink-0 text-pink-deep" />
        <div className="flex-1 text-[14px] leading-snug text-muted">
          <span className="font-bold text-blue">Daily limit after this</span> — {usdcNumber(action.dailyRemainingAfter)} of{" "}
          {usdcNumber(action.dailyLimit)} USDC left
          <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-line">
            <motion.div className="h-full rounded-full bg-pink" initial={{ width: 0 }} animate={{ width: `${Math.max(4, usedPct)}%` }} transition={{ duration: 0.9 }} />
          </div>
          Per-payment cap {usdcNumber(action.perPaymentCap)} USDC · within limit
        </div>
      </div>

      {live && expired ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">This preview expired. I’ll simulate it again before you sign.</p>
          <Button variant="blue" onClick={onRefresh}>Simulate again</Button>
        </div>
      ) : live ? (
        <>
          <div className="flex items-center justify-between text-[12.5px] text-soft">
            <span>Mock mode · example site</span>
            <span className="nums">Preview valid {left}s</span>
          </div>
          <div className="grid grid-cols-[1fr_1.3fr] gap-3">
            <Button variant="outline-blue" size="lg" onClick={onCancel} disabled={state === "busy"}>Cancel</Button>
            <Button size="lg" onClick={onApprove} disabled={state === "busy"}>
              {state === "busy" ? "Signing…" : "Approve and sign"}
            </Button>
          </div>
        </>
      ) : (
        <div className={cx("flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold", state === "done" ? "bg-blue/[0.06]" : "justify-center bg-mist text-muted")}>
          {state === "done" ? (
            <>
              <span className="grid size-6 place-items-center rounded-full bg-pink text-white"><CheckIcon size={14} /></span>
              Approved and signed (mock)
            </>
          ) : (
            "Cancelled. Nothing was signed."
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12.5px] text-soft">{label}</div>
      <div className={cx("mt-1 flex items-center gap-1.5 truncate font-bold", mono ? "font-mono text-[13.5px]" : "nums text-[16px]")}>
        <span className="truncate">{value}</span>
        {badge && <Pill tone="blue" className="h-5 px-2 text-[9.5px]">{badge}</Pill>}
      </div>
    </div>
  );
}
