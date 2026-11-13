"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { PaymentLink, Quote, SendIntent } from "@/lib/types";
import { SparkIcon } from "../icons";
import { LinkCard, QuoteCard, SendCard, type CardState } from "../money-cards";
import { cx } from "../ui";

type Scenario = "swap" | "send" | "link";
type Stage = "asking" | "thinking" | "preview" | "done" | "cancelled";

const PROMPTS: Record<Scenario, { label: string; text: string; reply: string }> = {
  swap: { label: "Swap", text: "Change ₦50,000 to dollars", reply: "I compared three venues. Aquarius is the best rate right now." },
  send: { label: "Send", text: "Send $20 to Tunde", reply: "Ready to send. This is within your limits — confirm to go ahead." },
  link: { label: "Payment link", text: "Make a payment link for ₦15,000", reply: "Here’s a payment link for ₦15,000. Anyone with the link can pay you." },
};

// Fictional example objects (same figures as the mockups).
function exampleQuote(): Quote {
  return {
    id: "demo",
    from: "NGN",
    to: "USDC",
    amountIn: 50_000_00,
    amountOut: 31_20,
    rate: 1602.56,
    fee: 125_00,
    venues: [
      { venue: "aquarius", name: "Aquarius", amountOut: 31_20, rate: 1602.56, best: true },
      { venue: "soroswap", name: "Soroswap", amountOut: 31_11, rate: 1607.2, best: false },
      { venue: "sdex", name: "SDEX", amountOut: 31_05, rate: 1610.3, best: false },
    ],
    unquoted: [],
    bestVenue: "aquarius",
    expiresAt: Date.now() + 60_000,
    status: "pending",
  };
}
function exampleSend(): SendIntent {
  return {
    id: "demo",
    to: { name: "Tunde", address: "example" },
    asset: "USDC",
    amount: 20_00,
    fee: 1,
    total: 20_01,
    balanceBefore: 248_60,
    dailyRemainingAfter: 180_00,
    dailyLimit: 200_00,
    perPaymentCap: 50_00,
    expiresAt: Date.now() + 60_000,
    status: "pending",
  };
}
function exampleLink(): PaymentLink {
  return {
    id: "demo",
    code: "8F2K-15K",
    url: "https://example.com/p/8F2K-15K",
    amount: 15_000_00,
    currency: "NGN",
    status: "open",
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 864e5,
  };
}

const STEPS = [
  { n: 1, title: "Ask in plain words", body: "Type it the way you’d say it. No menus, no forms." },
  { n: 2, title: "See the best rate and the full cost", body: "Wura compares SDEX, Soroswap and Aquarius and shows what you get, with the fee." },
  { n: 3, title: "Approve, or don’t", body: "Nothing moves until you say yes. Every move goes into your log." },
];

function Burst() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const d = 90 + (i % 3) * 30;
        return (
          <motion.span
            key={i}
            className={cx("absolute", i % 2 ? "text-pink" : "text-blue-bright")}
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, scale: [0.4, 1.1, 0.6], opacity: [1, 1, 0], rotate: 120 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <SparkIcon size={i % 3 === 0 ? 18 : 12} />
          </motion.span>
        );
      })}
    </div>
  );
}

export function HowDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const [scenario, setScenario] = useState<Scenario>("swap");
  const [stage, setStage] = useState<Stage>("preview");
  const [typed, setTyped] = useState(PROMPTS.swap.text.length);
  const [run, setRun] = useState(0);
  const [objs, setObjs] = useState<{ quote: Quote; send: SendIntent; link: PaymentLink } | null>(null);

  // Example objects carry timestamps, so build them in the browser only.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObjs({ quote: exampleQuote(), send: exampleSend(), link: exampleLink() });
  }, []);

  // Play the ask → think → preview sequence.
  useEffect(() => {
    if (run === 0) return;
    let cancelled = false;
    const text = PROMPTS[scenario].text;
    (async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      setStage("asking");
      setTyped(0);
      for (let i = 1; i <= text.length && !cancelled; i++) {
        setTyped(i);
        await wait(30 + Math.random() * 25);
      }
      if (cancelled) return;
      setStage("thinking");
      await wait(850);
      if (cancelled) return;
      setObjs({ quote: exampleQuote(), send: exampleSend(), link: exampleLink() });
      setStage(scenario === "link" ? "done" : "preview");
    })();
    return () => {
      cancelled = true;
    };
  }, [run, scenario]);

  useEffect(() => {
    // First time the demo scrolls into view, play it once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inView) setRun((r) => (r === 0 ? 1 : r));
  }, [inView]);

  function pick(s: Scenario) {
    setScenario(s);
    setRun((r) => r + 1);
  }

  const activeStep = stage === "asking" ? 1 : stage === "thinking" || stage === "preview" ? 2 : 3;
  const cardState: CardState = stage === "done" ? "done" : stage === "cancelled" ? "cancelled" : "pending";
  const p = PROMPTS[scenario];

  return (
    <div ref={ref} className="grid items-start gap-10 lg:grid-cols-[1fr_520px] lg:gap-16">
      <div className="flex flex-col gap-8">
        <ol className="flex flex-col gap-3">
          {STEPS.map((s) => {
            const on = s.n === activeStep;
            const done = s.n < activeStep;
            return (
              <li
                key={s.n}
                className={cx(
                  "relative flex gap-4 rounded-card p-5 transition-all duration-500",
                  on ? "bg-white shadow-card" : "bg-transparent",
                )}
              >
                <span
                  className={cx(
                    "grid size-9 shrink-0 place-items-center rounded-full text-[15px] font-bold transition-colors duration-500",
                    on ? "bg-pink text-white" : done ? "bg-blue text-white" : "bg-blue/[0.08] text-blue",
                  )}
                >
                  {s.n}
                </span>
                <div>
                  <h3 className="text-[19px] font-bold tracking-[-0.03em]">{s.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div>
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-soft">Try one</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PROMPTS) as Scenario[]).map((s) => (
              <button
                key={s}
                onClick={() => pick(s)}
                className={cx(
                  "rounded-full px-5 py-2.5 text-[14px] font-semibold transition",
                  scenario === s ? "bg-blue text-white shadow-soft" : "bg-white text-blue shadow-[0_2px_10px_rgba(8,49,141,0.08)] hover:-translate-y-0.5",
                )}
              >
                {PROMPTS[s].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Demo phone */}
      <div className="relative mx-auto w-full max-w-[520px]">
        <div className="relative overflow-hidden rounded-[32px] bg-page p-4 shadow-[0_30px_80px_rgba(8,22,80,0.25)] ring-1 ring-white sm:p-5">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[17px] font-bold tracking-[-0.03em]">Wura</span>
            <span className="rounded-full bg-[#E2E9F6] px-3 py-1.5 text-[12px] font-bold">Demo · example figures</span>
          </div>
          <div className="flex min-h-[560px] flex-col gap-3">
            <div className="ml-auto max-w-[88%] rounded-[20px] rounded-br-md bg-blue px-4 py-2.5 text-[15px] text-white">
              {p.text.slice(0, typed)}
              {stage === "asking" && <span className="ml-0.5 inline-block h-3.5 w-px animate-blink bg-white align-middle" />}
            </div>
            <AnimatePresence mode="wait">
              {stage === "thinking" && (
                <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-[9px] bg-blue text-white"><SparkIcon size={12} /></span>
                  <div className="flex gap-1 rounded-[18px] bg-white px-4 py-3.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="size-1.5 animate-blink rounded-full bg-blue/60" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </motion.div>
              )}
              {objs && (stage === "preview" || stage === "done" || stage === "cancelled") && (
                <motion.div key={`r-${scenario}-${run}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px] bg-blue text-white"><SparkIcon size={12} /></span>
                    <div className="rounded-[18px] rounded-tl-md bg-white px-4 py-2.5 text-[14.5px] leading-snug">{p.reply}</div>
                  </div>
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="relative rounded-card-lg bg-white p-5 shadow-[0_18px_40px_rgba(8,49,141,0.12)]"
                  >
                    {scenario === "swap" && (
                      <QuoteCard
                        quote={objs.quote}
                        state={cardState}
                        onApprove={() => setStage("done")}
                        onCancel={() => setStage("cancelled")}
                        onRefresh={() => pick("swap")}
                      />
                    )}
                    {scenario === "send" && (
                      <SendCard
                        intent={objs.send}
                        state={cardState}
                        onConfirm={() => setStage("done")}
                        onCancel={() => setStage("cancelled")}
                        onRefresh={() => pick("send")}
                      />
                    )}
                    {scenario === "link" && <LinkCard link={objs.link} />}
                    {stage === "done" && scenario !== "link" && <Burst />}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="mt-3 text-center text-[12.5px] text-soft">
          This demo runs in your browser. Nothing is sent and no money moves.
        </p>
      </div>
    </div>
  );
}
