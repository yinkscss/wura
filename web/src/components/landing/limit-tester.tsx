"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CheckIcon, ShieldIcon } from "../icons";
import { cx } from "../ui";

// Mirrors the server rule with example numbers: per-payment cap 50 USDC,
// 180 USDC left today. The real check runs on the server, not here.
const CAP = 50;
const LEFT = 180;
const MAX = 120;

export function LimitTester() {
  const [amt, setAmt] = useState(20);
  const over = amt > CAP;
  const pct = (amt / MAX) * 100;
  const capPct = (CAP / MAX) * 100;
  return (
    <div className="flex flex-col gap-6 rounded-card-lg bg-white p-6 text-blue shadow-card sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-soft">Try the limit · example</div>
          <div className="mt-1 text-[22px] font-bold tracking-[-0.03em]">
            “Send <span className="nums">${amt}</span> to Tunde”
          </div>
        </div>
        <span className={cx("grid size-11 shrink-0 place-items-center rounded-2xl transition-colors", over ? "bg-pink text-white" : "bg-blue/[0.07] text-blue")}>
          <ShieldIcon size={20} />
        </span>
      </div>

      <div className="relative pt-7">
        <div className="absolute top-0 -translate-x-1/2 text-[11.5px] font-bold text-pink-deep" style={{ left: `${capPct}%` }}>
          Cap $50
        </div>
        <div className="absolute top-5 h-[22px] w-0.5 -translate-x-1/2 rounded bg-pink" style={{ left: `${capPct}%` }} />
        <div className="relative h-3 overflow-hidden rounded-full bg-mist">
          <motion.div
            className={cx("absolute inset-y-0 left-0 rounded-full", over ? "bg-pink" : "bg-blue")}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
        <label htmlFor="limit-amount" className="sr-only">Amount to send in dollars</label>
        <input
          id="limit-amount"
          type="range"
          min={1}
          max={MAX}
          value={amt}
          onChange={(e) => setAmt(Number(e.target.value))}
          className="absolute inset-x-0 top-5 h-6 w-full cursor-pointer opacity-0"
        />
        <div className="mt-2 flex justify-between text-[12px] font-medium text-soft">
          <span>$1</span>
          <span>Drag to change the amount</span>
          <span>${MAX}</span>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={over ? "over" : "ok"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className={cx("flex items-start gap-3 rounded-2xl p-4 text-[14.5px] leading-snug", over ? "bg-pink/15 text-pink-deep" : "bg-mist text-muted")}
        >
          <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white", over ? "bg-pink" : "bg-blue")}>
            {over ? <span className="text-[13px] font-bold">!</span> : <CheckIcon size={13} />}
          </span>
          {over ? (
            <span>
              <b>Refused before signing.</b> ${amt} is over your ${CAP} per-payment cap, so the agent won’t send it. Nothing moves.
            </span>
          ) : (
            <span>
              <b className="text-blue">Within limits.</b> The agent shows a preview — {LEFT - amt} of {LEFT} USDC left today after this — and waits for your yes.
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
