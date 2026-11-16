"use client";

import { motion, useReducedMotion } from "motion/react";
import { cx } from "../ui";
import { Floater, StickerImg, isDesktop, useTier, type StickerName } from "./stickers";

type Spot = { name: StickerName; className: string; width: number; rot: number; delay: number };

// ≥1024: landmarks peek in from the bottom edges (behind the card), the gate
// and coins only where there is a real side gutter (≥1280).
const LG: Spot[] = [
  { name: "big-ben", className: "-bottom-[46px] -left-[26px]", width: 66, rot: -5, delay: 0.5 },
  { name: "statue-of-liberty", className: "-bottom-[40px] -right-[44px]", width: 150, rot: 4, delay: 0.6 },
  { name: "coin-dollar-teal", className: "bottom-[150px] right-[120px]", width: 48, rot: 9, delay: 0.75 },
];
const XL: Spot[] = [
  { name: "big-ben", className: "-bottom-[40px] -left-[20px]", width: 104, rot: -5, delay: 0.5 },
  { name: "black-star-gate", className: "left-[-40px] top-[150px] min-[1440px]:left-[-34px]", width: 120, rot: 5, delay: 0.6 },
  { name: "coin-usdc-blue", className: "left-[18px] bottom-[300px] min-[1440px]:left-[84px]", width: 54, rot: -10, delay: 0.7 },
  { name: "coin-euro", className: "right-[34px] top-[120px]", width: 52, rot: 8, delay: 0.75 },
  { name: "statue-of-liberty", className: "-bottom-[40px] -right-[40px]", width: 176, rot: 4, delay: 0.65 },
];
// Phones and tablets: two small peekers at the bottom corners.
const SMALL: Spot[] = [
  { name: "big-ben", className: "-bottom-[26px] -left-[10px]", width: 36, rot: -5, delay: 0.6 },
  { name: "statue-of-liberty", className: "-bottom-[24px] -right-[12px]", width: 54, rot: 4, delay: 0.7 },
];

/** Decorative stickers for the sign-in screen. Sits behind the copy and card (z-10). */
export function SignInStickers() {
  const tier = useTier();
  const reduce = !!useReducedMotion();
  if (!tier) return null;
  const spots = !isDesktop(tier) ? SMALL : tier === "lg" ? LG : XL;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none">
      {spots.map((s, i) => (
        <motion.div
          key={s.name}
          className={cx("absolute", s.className)}
          style={{ width: s.width, rotate: s.rot }}
          initial={reduce ? false : { opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: s.delay, ease: [0.22, 1, 0.36, 1] }}
        >
          <Floater amount={reduce ? 0 : 6 + (i % 3) * 2} seed={i * 2 + 1}>
            <StickerImg name={s.name} sizes={`${s.width}px`} />
          </Floater>
        </motion.div>
      ))}
    </div>
  );
}
