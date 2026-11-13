"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../ui";

/* Example figures only: ₦50,000 → USDC across three venues. */
const VENUES = [
  { id: "sdex", name: "SDEX", out: "31.05", y: 62 },
  { id: "soroswap", name: "Soroswap", out: "31.11", y: 160 },
  { id: "aquarius", name: "Aquarius", out: "31.20", y: 258, best: true },
];
const L = { x: 92, y: 160 };
const R = { x: 628, y: 160 };
const VX = 360;

const inPath = (y: number) => `M ${L.x} ${L.y} C ${L.x + 130} ${L.y}, ${VX - 150} ${y}, ${VX - 62} ${y}`;
const outPath = (y: number) => `M ${VX + 62} ${y} C ${VX + 150} ${y}, ${R.x - 130} ${R.y}, ${R.x} ${R.y}`;

type Phase = 0 | 1 | 2 | 3; // 0 idle, 1 asking, 2 quotes in, 3 best picked

export function RoutingViz() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(3);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    let cancelled = false;
    const run = async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      while (!cancelled) {
        setCycle((c) => c + 1);
        setPhase(1);
        await wait(1500);
        if (cancelled) return;
        setPhase(2);
        await wait(1100);
        if (cancelled) return;
        setPhase(3);
        await wait(4200);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [inView, reduce]);

  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-card-lg bg-white p-4 shadow-card sm:p-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-soft">Live route · example</div>
        <div className="text-[12px] font-semibold text-soft">
          {phase === 1 ? "Asking venues…" : phase === 2 ? "Comparing…" : "Best route picked"}
        </div>
      </div>
      <svg viewBox="0 0 720 320" className="h-auto w-full" role="img" aria-label="₦50,000 is quoted on SDEX, Soroswap and Aquarius; Aquarius gives the most USDC, 31.20.">
        <defs>
          <linearGradient id="bestGrad" x1="0" x2="1">
            <stop offset="0" stopColor="#FD91CC" />
            <stop offset="1" stopColor="#E85AAF" />
          </linearGradient>
        </defs>

        {VENUES.map((v) => {
          const best = phase === 3 && v.best;
          const dim = phase === 3 && !v.best;
          return (
            <g key={v.id}>
              {[inPath(v.y), outPath(v.y)].map((d, k) => (
                <g key={k}>
                  <path d={d} stroke="#E6EAF4" strokeWidth={2} fill="none" />
                  <motion.path
                    key={`${cycle}-${k}`}
                    d={d}
                    fill="none"
                    stroke={best ? "url(#bestGrad)" : "#08318D"}
                    strokeWidth={best ? 4 : 2}
                    strokeLinecap="round"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{
                      pathLength: k === 0 ? (phase >= 1 ? 1 : 0) : phase >= 3 ? (v.best ? 1 : 0) : phase >= 2 ? 0.0001 : 0,
                      opacity: dim ? 0.18 : 1,
                    }}
                    transition={{ duration: k === 0 ? 0.9 : 0.8, ease: [0.65, 0, 0.35, 1] }}
                  />
                </g>
              ))}
              {/* travelling packet */}
              {phase === 1 && !reduce && (
                <motion.circle
                  key={`dot-${cycle}`}
                  r={4}
                  fill="#FD91CC"
                  style={{ offsetPath: `path("${inPath(v.y)}")`, offsetRotate: "0deg" } as React.CSSProperties}
                  initial={{ offsetDistance: "0%", opacity: 0 }}
                  animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.1, ease: "easeInOut" }}
                />
              )}
              {phase === 3 && v.best && !reduce && (
                <motion.circle
                  key={`win-${cycle}`}
                  r={5}
                  fill="#E85AAF"
                  style={{ offsetPath: `path("${outPath(v.y)}")`, offsetRotate: "0deg" } as React.CSSProperties}
                  initial={{ offsetDistance: "0%" }}
                  animate={{ offsetDistance: "100%" }}
                  transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }}
                />
              )}
              {/* venue node */}
              <motion.g animate={{ opacity: dim ? 0.55 : 1 }}>
                <rect
                  x={VX - 62}
                  y={v.y - 26}
                  width={124}
                  height={52}
                  rx={14}
                  fill={best ? "#FFEAF5" : "#F3F6FC"}
                  stroke={best ? "#FD91CC" : "transparent"}
                  strokeWidth={1.5}
                />
                <text x={VX} y={v.y - 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="#08318D" style={{ fontFamily: "var(--font-sans)" }}>
                  {v.name}
                </text>
                <text
                  x={VX}
                  y={v.y + 15}
                  textAnchor="middle"
                  fontSize="12.5"
                  fontWeight="700"
                  fill={best ? "#E85AAF" : "#4B5F99"}
                  style={{ fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums", transition: "opacity .3s" }}
                  opacity={phase >= 2 ? 1 : 0.25}
                >
                  {phase >= 2 ? `${v.out} USDC` : "· · ·"}
                </text>
              </motion.g>
            </g>
          );
        })}

        {/* source node */}
        <g>
          <rect x={L.x - 80} y={L.y - 34} width={150} height={68} rx={18} fill="#08318D" />
          <text x={L.x - 5} y={L.y - 7} textAnchor="middle" fontSize="11" fontWeight="600" fill="rgba(255,255,255,.7)" style={{ fontFamily: "var(--font-sans)", letterSpacing: ".08em" }}>
            YOU PAY
          </text>
          <text x={L.x - 5} y={L.y + 16} textAnchor="middle" fontSize="19" fontWeight="700" fill="#fff" style={{ fontFamily: "var(--font-sans)" }}>
            ₦50,000
          </text>
        </g>
        {/* destination node */}
        <g>
          <rect x={R.x - 4} y={R.y - 34} width={88} height={68} rx={18} fill={phase === 3 ? "#FD91CC" : "#F3F6FC"} style={{ transition: "fill .4s" }} />
          <text x={R.x + 40} y={R.y - 7} textAnchor="middle" fontSize="11" fontWeight="600" fill={phase === 3 ? "rgba(255,255,255,.85)" : "#8A97B8"} style={{ fontFamily: "var(--font-sans)", letterSpacing: ".08em" }}>
            YOU GET
          </text>
          <text x={R.x + 40} y={R.y + 16} textAnchor="middle" fontSize="18" fontWeight="700" fill={phase === 3 ? "#fff" : "#8A97B8"} style={{ fontFamily: "var(--font-sans)" }}>
            {phase === 3 ? "31.20" : "—"}
          </text>
        </g>
      </svg>
      <AnimatePresence>
        {phase === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cx("mx-1 mt-1 rounded-2xl bg-mist px-4 py-3 text-[13.5px] text-muted")}
          >
            <b className="text-blue">Aquarius</b> gives the most: 31.20 USDC, fee included. You still have to approve before anything moves.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
