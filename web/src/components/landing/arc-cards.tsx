"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Gauge } from "../gauge";
import { CheckIcon, LinkIcon, SendIcon, SwapIcon } from "../icons";
import { copyText } from "../money-cards";
import { useAnimatedNumber } from "../use-animated-number";
import { cx } from "../ui";

/* All figures here are fictional example data from the design mockups. */

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setR(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, []);
  return r;
}

/** Runs `step` on a timer while `active`, unless reduced motion is on. */
function useLoop(active: boolean, ms: number, step: () => void) {
  const reduced = useReduced();
  const ref = useRef(step);
  useEffect(() => {
    ref.current = step;
  });
  useEffect(() => {
    if (!active || reduced) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [active, ms, reduced]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function CardTitle({ children, light }: { children: ReactNode; light?: boolean }) {
  return (
    <h3 className={cx("mb-3 text-[13px] font-semibold tracking-[-0.01em]", light ? "text-white/95" : "text-blue")}>
      {children}
    </h3>
  );
}

/* ---------------- In chat: types out a request, then the agent replies ---------------- */

const SCENES: Array<{ user: string; agent: ReactNode }> = [
  {
    user: "Change ₦50,000 to dollars",
    agent: (
      <>
        I compared three venues. Aquarius is the best rate right now — you’ll get <b className="font-bold">31.20 USDC</b>.
      </>
    ),
  },
  {
    user: "Send $20 to Tunde",
    agent: (
      <>
        Ready to send <b className="font-bold">20.00 USDC</b> to Tunde. It’s within your limits — confirm to go ahead.
      </>
    ),
  },
  {
    user: "Payment link for ₦15,000",
    agent: (
      <>
        Here’s your link: <b className="font-bold">example.com/p/8F2K-15K</b>. Anyone with it can pay you.
      </>
    ),
  },
];

export function ChatSnippetCard({ active }: { active: boolean }) {
  const reduced = useReduced();
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState(SCENES[0].user.length);
  const [phase, setPhase] = useState<"typing" | "thinking" | "reply">("reply");

  useEffect(() => {
    if (!active || reduced) return;
    let cancelled = false;
    (async () => {
      await sleep(3200);
      let s = 0;
      while (!cancelled) {
        s = (s + 1) % SCENES.length;
        setScene(s);
        setPhase("typing");
        setTyped(0);
        const text = SCENES[s].user;
        for (let i = 1; i <= text.length && !cancelled; i++) {
          setTyped(i);
          await sleep(38 + Math.random() * 30);
        }
        if (cancelled) return;
        setPhase("thinking");
        await sleep(900);
        if (cancelled) return;
        setPhase("reply");
        await sleep(3600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, reduced]);

  const s = SCENES[scene];
  return (
    <div className="flex h-full flex-col">
      <CardTitle>In chat</CardTitle>
      <div className="flex flex-col gap-2.5">
        <div className="self-end rounded-[14px] rounded-br-[5px] bg-blue px-3 py-2 text-[12.5px] leading-snug tracking-[-0.01em] text-white">
          {s.user.slice(0, typed)}
          {phase === "typing" && <span className="ml-0.5 inline-block h-3 w-px animate-blink bg-white align-middle" />}
        </div>
        <AnimatePresence mode="wait">
          {phase === "thinking" && (
            <motion.div
              key="dots"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex w-fit gap-1 rounded-[14px] rounded-bl-[5px] bg-mist px-3 py-3"
            >
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-blink rounded-full bg-blue/60" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </motion.div>
          )}
          {phase === "reply" && (
            <motion.div
              key={`r${scene}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-[94%] self-start rounded-[14px] rounded-bl-[5px] bg-mist px-3 py-2 text-[12.5px] leading-snug tracking-[-0.01em] text-blue [&_b]:text-pink-deep"
            >
              {s.agent}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- Rate comparison: shimmer, reveal, sort best to top ---------------- */

const RATES = [
  { id: "sdex", name: "SDEX", out: 31.05 },
  { id: "soroswap", name: "Soroswap", out: 31.11 },
  { id: "aquarius", name: "Aquarius", out: 31.2 },
];

export function RateCompareCard({ active }: { active: boolean }) {
  const reduced = useReduced();
  // Rest state: sorted, best highlighted.
  const [phase, setPhase] = useState<"compare" | "reveal" | "sorted">("sorted");
  const [revealed, setRevealed] = useState(3);

  useEffect(() => {
    if (!active || reduced) return;
    let cancelled = false;
    (async () => {
      await sleep(2400);
      while (!cancelled) {
        setPhase("compare");
        setRevealed(0);
        await sleep(1100);
        for (let i = 1; i <= 3 && !cancelled; i++) {
          setPhase("reveal");
          setRevealed(i);
          await sleep(380);
        }
        await sleep(350);
        if (cancelled) return;
        setPhase("sorted");
        await sleep(4600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, reduced]);

  const rows = phase === "sorted" ? [...RATES].sort((a, b) => b.out - a.out) : RATES;
  return (
    <div>
      <CardTitle>Rate comparison</CardTitle>
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[15px] font-bold tracking-[-0.03em]">₦50,000 → USDC</div>
        <div className="text-[12px] font-medium text-muted">
          You get{" "}
          <b className={cx("nums font-bold text-pink-deep transition-opacity", phase !== "sorted" && "opacity-30")}>31.20</b>
        </div>
      </div>
      <LayoutGroup>
        <div className="mt-3 flex flex-col gap-[7px]">
          {rows.map((r, i) => {
            const best = phase === "sorted" && r.id === "aquarius";
            const shown = phase === "sorted" || RATES.indexOf(r) < revealed;
            return (
              <motion.div
                layout
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                key={r.id}
                className={cx(
                  "relative grid grid-cols-[1fr_auto] items-center overflow-hidden rounded-xl px-3 py-[9px] text-[13px]",
                  best ? "bg-pink/[0.18] shadow-[inset_0_0_0_1.5px_var(--color-pink)]" : "bg-mist",
                )}
              >
                {phase === "compare" && <span className="shimmer-bg absolute inset-0 animate-shimmer opacity-70" style={{ animationDelay: `${i * 0.12}s` }} />}
                <div className="relative flex items-center gap-2">
                  <span className="font-semibold tracking-[-0.02em]">{r.name}</span>
                  <AnimatePresence>
                    {best && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                        className="rounded-full bg-pink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-white"
                      >
                        Best
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <span className={cx("nums relative font-bold tracking-[-0.02em] transition-opacity duration-300", best && "text-pink-deep", !shown && "opacity-0")}>
                  {r.out.toFixed(2)}
                </span>
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="mt-2.5 h-4 text-[11px] font-medium text-soft">
        {phase === "compare" ? "Asking three venues…" : phase === "reveal" ? "Comparing…" : "Example rates"}
      </div>
    </div>
  );
}

/* ---------------- Daily limit: pink gauge sweeps in ---------------- */

export function LimitCard({ active }: { active: boolean }) {
  // Hovering replays the sweep.
  const [replay, setReplay] = useState(0);
  return (
    <div className="flex h-full flex-col" onPointerEnter={() => setReplay((r) => r + 1)}>
      <CardTitle light>Daily limit</CardTitle>
      <LimitDial key={replay} active={active} />
    </div>
  );
}

function LimitDial({ active }: { active: boolean }) {
  const pct = useAnimatedNumber(active ? 58 : 0, { from: 0, duration: 1600, play: active });
  return (
    <div className="flex flex-col items-center">
      <Gauge value={active ? 0.58 : 0} size={200} play={active} label={String(Math.round(pct))} />
      <div className="nums -mt-[52px] text-center text-[72px] font-bold leading-none tracking-[-0.06em] text-white">
        {Math.round(pct)}
      </div>
      <div className="mt-0.5 text-center text-[13px] font-semibold text-white/90">% left today</div>
      <div className="mt-2 text-center text-[12px] font-medium text-white/80">₦116,000 of ₦200,000 remaining</div>
    </div>
  );
}

/* ---------------- Payment link: Copy works for real ---------------- */

export function PayLinkCard() {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <CardTitle>Payment link</CardTitle>
      <div className="nums mt-0.5 text-[28px] font-bold leading-[1.1] tracking-[-0.045em]">₦15,000</div>
      <div className="mt-1 flex items-center gap-2 text-[12.5px] font-medium text-muted">
        Request · expires in 7 days
      </div>
      <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-mist px-3 py-2.5">
        <LinkIcon size={14} className="shrink-0 text-blue/55" />
        <code className="truncate font-sans text-[13px] font-semibold">example.com/p/8F2K-15K</code>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={async () => {
            if (await copyText("https://example.com/p/8F2K-15K")) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold shadow-[inset_0_0_0_1.5px_rgba(8,49,141,0.22)] transition hover:shadow-[inset_0_0_0_1.5px_rgba(8,49,141,0.5)] active:scale-95"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? "c" : "n"} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="inline-flex items-center gap-1.5">
              {copied && <CheckIcon size={13} />}
              {copied ? "Copied" : "Copy"}
            </motion.span>
          </AnimatePresence>
        </button>
        <button
          onClick={async () => {
            const url = "https://example.com/p/8F2K-15K";
            try {
              if (navigator.share) {
                await navigator.share({ title: "Payment request", text: "Pay me ₦15,000 (example)", url });
                return;
              }
            } catch {
              return;
            }
            if (await copyText(url)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
          className="inline-flex h-9 items-center justify-center rounded-full bg-pink text-[13px] font-semibold text-white shadow-pink transition hover:bg-pink-hot active:scale-95"
        >
          Share
        </button>
      </div>
    </div>
  );
}

/* ---------------- Recent activity: new rows slide in ---------------- */

type Row = { key: number; what: string; meta: string; amt: string; icon: "swap" | "send" | "link" };
const POOL: Omit<Row, "key">[] = [
  { what: "Swap to USDC", meta: "Aquarius · 12 Nov", amt: "31.20", icon: "swap" },
  { what: "Sent to Tunde", meta: "USDC · 12 Nov", amt: "20.00", icon: "send" },
  { what: "Payment link", meta: "Open · 11 Nov", amt: "₦15,000", icon: "link" },
  { what: "Swap to naira", meta: "SDEX · 10 Nov", amt: "₦31,980", icon: "swap" },
  { what: "Sent to Ada", meta: "USDC · 9 Nov", amt: "12.50", icon: "send" },
];

const ICONS = { swap: SwapIcon, send: SendIcon, link: LinkIcon };

export function ActivityCard({ active }: { active: boolean }) {
  const [rows, setRows] = useState<Row[]>(POOL.slice(0, 3).map((r, i) => ({ ...r, key: i })));
  const next = useRef(3);
  useLoop(active, 3800, () => {
    const r = POOL[next.current % POOL.length];
    setRows((prev) => [{ ...r, key: next.current }, ...prev].slice(0, 3));
    next.current++;
  });
  return (
    <div>
      <CardTitle>Recent activity</CardTitle>
      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {rows.map((r, i) => {
            const Icon = ICONS[r.icon];
            return (
              <motion.div
                key={r.key}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className={cx("grid grid-cols-[28px_1fr_auto] items-center gap-2.5 py-2.5", i < rows.length - 1 && "border-b border-line")}
              >
                <span className={cx("grid size-7 place-items-center rounded-lg", r.icon === "swap" ? "bg-pink/[0.18] text-pink-deep" : "bg-mist text-blue")}>
                  <Icon size={14} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold tracking-[-0.02em]">{r.what}</div>
                  <div className="text-[11px] text-soft">{r.meta}</div>
                </div>
                <div className="nums text-right text-[12px] font-bold tracking-[-0.02em]">{r.amt}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
