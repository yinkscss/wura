"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cx } from "../ui";

/**
 * Decorative photo stickers (white-outlined cutouts in /public/landing/stickers).
 * Everything here is aria-hidden, unfocusable and pointer-events: none.
 */

export const STICKERS = {
  "big-ben": [268, 900],
  "black-star-gate": [900, 748],
  "burj-khalifa": [282, 900],
  camera: [900, 656],
  "coin-dollar-teal": [281, 288],
  "coin-euro": [280, 287],
  "coin-usdc-blue": [282, 288],
  "coin-usdc-lavender": [281, 288],
  "concrete-monument": [440, 900],
  "phone-currencies": [596, 900],
  "pyramid-sphinx": [900, 663],
  "statue-of-liberty": [399, 900],
} as const;

export type StickerName = keyof typeof STICKERS;

export const STICKER_SHADOW = "drop-shadow(0 14px 22px rgba(4,18,63,.28)) drop-shadow(0 2px 4px rgba(4,18,63,.18))";

/* ---------- breakpoint tier, so hidden stickers are never requested ---------- */

/** mobile <768, tablet 768–1023, lg 1024–1279, xl 1280–1599, wide ≥1600 */
export type Tier = "mobile" | "tablet" | "lg" | "xl" | "wide";

const Q_TABLET = "(min-width: 768px)";
const Q_LG = "(min-width: 1024px)";
const Q_XL = "(min-width: 1280px)";
const Q_WIDE = "(min-width: 1600px)";

function subscribe(cb: () => void) {
  const lists = [Q_TABLET, Q_LG, Q_XL, Q_WIDE].map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", cb));
  return () => lists.forEach((l) => l.removeEventListener("change", cb));
}

function snapshot(): Tier {
  if (window.matchMedia(Q_WIDE).matches) return "wide";
  if (window.matchMedia(Q_XL).matches) return "xl";
  if (window.matchMedia(Q_LG).matches) return "lg";
  if (window.matchMedia(Q_TABLET).matches) return "tablet";
  return "mobile";
}

/** null on the server and during hydration: stickers render client-side only. */
export function useTier(): Tier | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export const isDesktop = (t: Tier | null) => t === "lg" || t === "xl" || t === "wide";

/* ---------- the image itself ---------- */

export function StickerImg({
  name,
  sizes,
  className,
  style,
}: {
  name: StickerName;
  /** Rendered CSS width(s), so the optimiser serves a small file. */
  sizes: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [w, h] = STICKERS[name];
  // The shadow lives on a wrapper so it is drawn from the already-masked image.
  // On the same element, a fade mask would clip the shadow at the image's
  // rectangular box and leave a visible square edge.
  return (
    <span className="block" style={{ filter: STICKER_SHADOW }}>
      <Image
        src={`/landing/stickers/${name}.webp`}
        alt=""
        width={w}
        height={h}
        sizes={sizes}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cx("block h-auto w-full select-none", className)}
        style={style}
      />
    </span>
  );
}

/* ---------- scroll-aware sticker for the sections below the hero ---------- */

/**
 * Grows in as it scrolls into view, peaks mid-screen, then eases back down
 * and drifts up as it leaves. Still when reduced motion is on.
 */
type ScrollStickerProps = {
  name: StickerName;
  /** Position + width classes (absolute). */
  className: string;
  sizes: string;
  rotate?: number;
  /** Parallax strength; negative moves the other way. */
  depth?: number;
  float?: number;
  /** Soft mask toward the bottom edge. */
  fade?: boolean;
};

/** "large" = ≥1024px, "small" = phones and tablets, "mobile" = <768px. Not rendered (or downloaded) elsewhere. */
export function ScrollSticker({ show, ...props }: ScrollStickerProps & { show: "large" | "small" | "mobile" | "all" }) {
  const tier = useTier();
  if (!tier) return null;
  if (show === "large" && !isDesktop(tier)) return null;
  if (show === "small" && isDesktop(tier)) return null;
  if (show === "mobile" && tier !== "mobile") return null;
  return <ScrollStickerInner {...props} />;
}

function ScrollStickerInner({
  name,
  className,
  sizes,
  rotate = 0,
  depth = 1,
  float = 8,
  fade,
}: ScrollStickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 0.45, 1], [0.72, 1.06, 0.86]);
  const rot = useTransform(scrollYProgress, [0, 0.5, 1], [rotate - 9 * Math.sign(depth || 1), rotate, rotate + 5 * Math.sign(depth || 1)]);
  const y = useTransform(scrollYProgress, [0, 1], [70 * depth, -70 * depth]);
  const opacity = useTransform(scrollYProgress, [0, 0.18, 0.9, 1], [0, 1, 1, 0.5]);

  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      className={cx("pointer-events-none absolute", className)}
      style={reduce ? { rotate } : { scale, rotate: rot, y, opacity }}
    >
      <Floater amount={reduce ? 0 : float} seed={name.length}>
        <StickerImg
          name={name}
          sizes={sizes}
          style={fade ? { maskImage: "linear-gradient(to bottom,#000 62%,transparent)", WebkitMaskImage: "linear-gradient(to bottom,#000 62%,transparent)" } : undefined}
        />
      </Floater>
    </motion.div>
  );
}

/** Gentle idle bob; amount 0 disables it. */
export function Floater({ amount, seed = 0, children }: { amount: number; seed?: number; children: ReactNode }) {
  if (!amount) return <span className="block">{children}</span>;
  const duration = 6 + (seed % 4); // 6–9s
  return (
    <motion.span
      className="block"
      animate={{ y: [0, -amount, 0, amount * 0.6, 0], rotate: [0, 1.5, 0, -1.2, 0] }}
      transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: (seed % 5) * 0.45 }}
    >
      {children}
    </motion.span>
  );
}
