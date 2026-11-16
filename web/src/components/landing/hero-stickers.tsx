"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";
import { cx } from "../ui";
import { Floater, STICKERS, StickerImg, isDesktop, useTier, type StickerName, type Tier } from "./stickers";

/**
 * Payrit-style landmark + coin stickers on the hero's left and right edges.
 * They sit behind the copy (z-10) and the arc cards (z-20), never over text.
 */

type Spot = {
  name: StickerName;
  side: "left" | "right";
  /** Offset from that edge, px at the 1440 reference. */
  x: number;
  top: number;
  /** Give one of w / h (px at 1440); the other follows the image ratio. */
  w?: number;
  h?: number;
  rot: number;
  /** Parallax depth 0..1. */
  depth: number;
  fade?: boolean;
  /** Lowest tier that shows it. (camera / concrete-monument at ≥1600 crowded the arc, so they live in the sections below instead.) */
  from: "lg" | "xl" | "wide";
};

// Reference layout at 1440×900 (gutter beside the 620px text column = 410px).
// One overlapping collage per side, low on the edges and bleeding off-screen,
// so the sky above and around the headline stays clear (Payrit-style). Order
// is paint order: later entries sit on top within a side.
const DESKTOP: Spot[] = [
  { name: "big-ben", side: "left", x: -34, top: 150, h: 400, rot: -7, depth: 0.6, from: "lg" },
  { name: "black-star-gate", side: "left", x: 64, top: 336, w: 280, rot: 5, depth: 0.45, from: "xl" },
  { name: "pyramid-sphinx", side: "left", x: -90, top: 500, w: 340, rot: -4, depth: 0.3, fade: true, from: "lg" },
  { name: "coin-usdc-blue", side: "left", x: 196, top: 300, w: 62, rot: -10, depth: 0.8, from: "xl" },

  { name: "statue-of-liberty", side: "right", x: -64, top: 140, h: 420, rot: 4, depth: 0.6, from: "lg" },
  { name: "burj-khalifa", side: "right", x: 150, top: 262, h: 330, rot: -6, depth: 0.45, fade: true, from: "xl" },
  { name: "phone-currencies", side: "right", x: 24, top: 392, w: 205, rot: 11, depth: 0.35, fade: true, from: "lg" },
  { name: "coin-euro", side: "right", x: 206, top: 548, w: 58, rot: -8, depth: 0.8, from: "xl" },
];

// 768–1023: four landmarks at ~70% and a coin per side, fixed px.
const TABLET: Spot[] = [
  { name: "big-ben", side: "left", x: -22, top: 108, h: 220, rot: -4, depth: 0.7, from: "lg" },
  { name: "coin-dollar-teal", side: "left", x: 104, top: 150, w: 38, rot: 8, depth: 1, from: "lg" },
  { name: "black-star-gate", side: "left", x: -46, top: 462, w: 175, rot: 4, depth: 0.4, fade: true, from: "lg" },
  { name: "statue-of-liberty", side: "right", x: -62, top: 96, h: 252, rot: 3, depth: 0.6, from: "lg" },
  { name: "coin-euro", side: "right", x: 116, top: 160, w: 38, rot: -8, depth: 1, from: "lg" },
  { name: "phone-currencies", side: "right", x: -20, top: 440, w: 119, rot: 10, depth: 0.4, fade: true, from: "lg" },
];

const RANK = { lg: 0, xl: 1, wide: 2 } as const;
const SCALE_MIN = 0.62;
const SCALE_MAX = 1.15;

/** px at 1440 → CSS length that tracks the side gutter ((100vw − 620px) / 820px), clamped. */
function sc(v: number) {
  if (v === 0) return "0px";
  const lo = v * SCALE_MIN;
  const hi = v * SCALE_MAX;
  const fluid = `calc(${((v * 100) / 820).toFixed(3)}vw - ${((v * 620) / 820).toFixed(2)}px)`;
  return `clamp(${Math.min(lo, hi).toFixed(1)}px, ${fluid}, ${Math.max(lo, hi).toFixed(1)}px)`;
}

function widthOf(s: Spot) {
  const [iw, ih] = STICKERS[s.name];
  return s.w ?? ((s.h ?? 0) * iw) / ih;
}

export function HeroStickers({ progress }: { progress: MotionValue<number> }) {
  const tier = useTier();
  const reduce = !!useReducedMotion();
  const desktop = isDesktop(tier);

  // Desktop-only mouse parallax, rAF-throttled.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18 });
  const sy = useSpring(my, { stiffness: 60, damping: 18 });
  useEffect(() => {
    if (!desktop || reduce) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          mx.set(px);
          my.set(py);
        });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [desktop, reduce, mx, my]);

  const spots =
    !tier || tier === "mobile"
      ? []
      : desktop
        ? DESKTOP.filter((s) => RANK[s.from] <= RANK[tier as Exclude<Tier, "mobile" | "tablet">])
        : TABLET;

  // The wrapper and cloud layer are server-rendered (no layout shift on hydration); stickers mount client-side per breakpoint.
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none">
      {/* soft clouds over the lower sky (md and up); the deep blue at the top stays clean */}
      {/* Full-size box (its origin never moves as the hero grows, so no layout shift); the image fills the lower 58%. */}
      <div
        className="absolute inset-0 hidden bg-no-repeat opacity-50 mix-blend-screen md:block"
        style={{
          backgroundImage: "url(/landing/stickers/sky-bg.webp)",
          backgroundPosition: "center bottom",
          backgroundSize: "100% 58%",
          maskImage: "linear-gradient(to bottom, transparent 42%, #000 68%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 42%, #000 68%)",
        }}
      />
      {spots.map((s, i) => (
        <HeroSticker key={s.name} spot={s} index={i} scaled={desktop} tier={tier as Tier} reduce={reduce} progress={progress} mx={sx} my={sy} />
      ))}
      {/* melt the sticker bottoms into the white hero floor */}
      <div className="absolute inset-0 hidden bg-[linear-gradient(to_bottom,transparent_66%,#f3f8ff_90%,#fff_100%)] md:block" />
    </div>
  );
}

function HeroSticker({
  spot: s,
  index,
  scaled,
  tier,
  reduce,
  progress,
  mx,
  my,
}: {
  spot: Spot;
  index: number;
  scaled: boolean;
  tier: Tier;
  reduce: boolean;
  progress: MotionValue<number>;
  mx: MotionValue<number>;
  my: MotionValue<number>;
}) {
  const w = widthOf(s);
  const y = useTransform(progress, [0, 1], [0, -40 - 50 * s.depth]);
  const px = useTransform(mx, (v) => v * -14 * s.depth);
  const py = useTransform(my, (v) => v * -9 * s.depth);
  // Largest rendered width for this tier, so the optimiser sends a small file.
  const maxW = Math.ceil(w * (scaled ? (tier === "lg" ? 0.8 : SCALE_MAX) : 1));
  const fadeMask = s.fade ? "linear-gradient(to bottom,#000 58%,transparent 98%)" : undefined;

  return (
    <div
      className="absolute"
      style={{
        [s.side]: scaled ? sc(s.x) : `${s.x}px`,
        top: s.top,
        width: scaled ? sc(w) : `${w}px`,
      }}
    >
      <motion.div style={reduce ? undefined : { y }}>
        <motion.div style={reduce ? undefined : { x: px, y: py }}>
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.95 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
            style={{ rotate: s.rot }}
          >
            <Floater amount={reduce ? 0 : 3 + (index % 2) * 2} seed={index + s.name.length}>
              <StickerImg name={s.name} sizes={`${maxW}px`} style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined} />
            </Floater>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ---------- mobile: four small accents only ---------- */

/** Two coins beside the headline. Render inside the h1 (it is inline-block, sized to the text). */
export function HeroHeadlineCoins() {
  const tier = useTier();
  const reduce = !!useReducedMotion();
  if (tier !== "mobile") return null;
  return (
    <>
      <MobileAccent name="coin-usdc-blue" width={34} rot={-10} reduce={reduce} index={0} className="-left-[46px] top-[40%]" />
      <MobileAccent name="coin-euro" width={30} rot={8} reduce={reduce} index={1} className="-right-[44px] top-[60%]" />
    </>
  );
}

/** Big Ben and Liberty peeking in from the edges, under the CTAs and behind the cards. Place in a zero-height anchor after the copy. */
export function HeroMobilePeek() {
  const tier = useTier();
  const reduce = !!useReducedMotion();
  if (tier !== "mobile") return null;
  return (
    <>
      <MobileAccent name="big-ben" width={Math.round((120 * 268) / 900)} rot={-5} reduce={reduce} index={2} className="-left-[8px] -top-[24px]" />
      <MobileAccent name="statue-of-liberty" width={Math.round((118 * 399) / 900)} rot={4} reduce={reduce} index={3} className="-right-[10px] -top-[22px]" />
    </>
  );
}

function MobileAccent({ name, width, rot, reduce, index, className }: { name: StickerName; width: number; rot: number; reduce: boolean; index: number; className: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cx("pointer-events-none absolute block", className)}
      style={{ width, rotate: rot }}
      initial={reduce ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, delay: 1 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <Floater amount={reduce ? 0 : 4} seed={index * 3 + 1}>
        <StickerImg name={name} sizes={`${width}px`} />
      </Floater>
    </motion.span>
  );
}
