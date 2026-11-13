"use client";

import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cx } from "../ui";
import { ActivityCard, ChatSnippetCard, LimitCard, PayLinkCard, RateCompareCard } from "./arc-cards";

/**
 * Landing-only half-moon arc. Centre card highest and in front, mid cards a
 * step lower at ±7°, far cards lower still at ±13° (design/README.md).
 * Coordinates are in a 1440-wide design space and scaled to fit.
 */
const STAGE_W = 1440;
const STAGE_H = 470;

type Slot = { left: number; top: number; w: number; h: number; rot: number; z: number; scale?: number };
const SLOTS: Slot[] = [
  { left: 107, top: 130, w: 246, h: 276, rot: -13, z: 2 },
  { left: 343, top: 38, w: 252, h: 292, rot: -7, z: 4 },
  { left: 590, top: 0, w: 260, h: 312, rot: 0, z: 6, scale: 1.05 },
  { left: 845, top: 38, w: 252, h: 292, rot: 7, z: 4 },
  { left: 1087, top: 130, w: 246, h: 276, rot: 13, z: 2 },
];
// Entrance order: centre first, then outward.
const ORDER = [2, 1, 3, 0, 4];

function ArcCard({
  i,
  hovered,
  setHovered,
  spread,
  pink,
  entered,
  children,
}: {
  entered: boolean;
  i: number;
  hovered: number | null;
  setHovered: (i: number | null) => void;
  spread: MotionValue<number>;
  pink?: boolean;
  children: ReactNode;
}) {
  const s = SLOTS[i];
  const reduce = useReducedMotion();
  const isHover = hovered === i;
  // Neighbours lean away from the hovered card.
  const push = hovered == null || isHover ? 0 : (i < hovered ? -1 : 1) * (Math.abs(i - hovered) === 1 ? 22 : 10);
  const side = i - 2; // -2..2
  const spreadX = useTransform(spread, (v) => side * v * 34);
  const spreadY = useTransform(spread, (v) => Math.abs(side) * v * -10);
  const delay = ORDER.indexOf(i) * 0.09 + 0.35;

  return (
    <motion.div
      className="absolute"
      style={{ left: s.left, top: s.top, width: s.w, height: s.h, zIndex: isHover ? 20 : s.z, x: spreadX, y: spreadY }}
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 220, rotate: 0, scale: 0.9 }}
        animate={{
          opacity: 1,
          y: isHover ? -22 : 0,
          x: push,
          rotate: isHover ? s.rot * 0.25 : s.rot,
          scale: isHover ? (s.scale ?? 1) * 1.05 : s.scale ?? 1,
        }}
        transition={{
          opacity: { duration: 0.5, delay: reduce ? 0 : delay },
          default: { type: "spring", stiffness: 170, damping: 20, mass: 0.9, delay: !entered && !reduce ? delay : 0 },
        }}
        onPointerEnter={() => setHovered(i)}
        onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered(i)}
        onBlur={() => setHovered(null)}
        className={cx(
          "h-full w-full overflow-hidden rounded-card p-4 pb-3.5 text-blue transition-shadow duration-300",
          pink
            ? "bg-[linear-gradient(180deg,#FF9AD0_0%,#FD7BC0_42%,#F34CB0_100%)] text-white shadow-[0_22px_48px_rgba(232,70,170,0.42)]"
            : "bg-white shadow-[0_18px_40px_rgba(8,22,80,0.22)]",
          isHover && (pink ? "shadow-[0_36px_70px_rgba(232,70,170,0.55)]" : "shadow-[0_34px_64px_rgba(8,22,80,0.32)]"),
        )}
        style={{ transformOrigin: "50% 100%" }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function HeroArc({ heroRef }: { heroRef: RefObject<HTMLElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const inView = useInView(wrap, { margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();

  // Pointer tilt for the whole arc.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotY = useSpring(useTransform(px, [-1, 1], [-5, 5]), { stiffness: 80, damping: 18 });
  const rotX = useSpring(useTransform(py, [-1, 1], [4, -4]), { stiffness: 80, damping: 18 });

  // Scroll: the arc fans out a little as the hero leaves.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const spread = useSpring(useTransform(scrollYProgress, [0, 0.7], [0, 1]), { stiffness: 120, damping: 24 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / STAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || reduce) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = hero.getBoundingClientRect();
      px.set(((e.clientX - r.left) / r.width) * 2 - 1);
      py.set(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onLeave = () => {
      px.set(0);
      py.set(0);
    };
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    return () => {
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
    };
  }, [heroRef, px, py, reduce]);

  return (
    <div ref={wrap} className="relative mx-auto w-full max-w-[1440px]" style={{ height: STAGE_H * scale }}>
      <motion.div
        className="absolute left-1/2 top-0 origin-top"
        style={{ width: STAGE_W, height: STAGE_H, x: "-50%", scale, rotateX: rotX, rotateY: rotY, transformPerspective: 1800 }}
      >
        <ArcCard i={0} hovered={hovered} setHovered={setHovered} spread={spread} entered={entered}>
          <ChatSnippetCard active={inView} />
        </ArcCard>
        <ArcCard i={1} hovered={hovered} setHovered={setHovered} spread={spread} entered={entered}>
          <RateCompareCard active={inView} />
        </ArcCard>
        <ArcCard i={2} hovered={hovered} setHovered={setHovered} spread={spread} entered={entered} pink>
          <LimitCard active={inView} />
        </ArcCard>
        <ArcCard i={3} hovered={hovered} setHovered={setHovered} spread={spread} entered={entered}>
          <PayLinkCard />
        </ArcCard>
        <ArcCard i={4} hovered={hovered} setHovered={setHovered} spread={spread} entered={entered}>
          <ActivityCard active={inView} />
        </ArcCard>
      </motion.div>
    </div>
  );
}

/** Phone widths: the same five cards, level, in a swipeable row. */
export function HeroCardsMobile() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const cards: Array<{ node: ReactNode; pink?: boolean }> = [
    { node: <LimitCard active={inView} />, pink: true },
    { node: <RateCompareCard active={inView} /> },
    { node: <ChatSnippetCard active={inView} /> },
    { node: <PayLinkCard /> },
    { node: <ActivityCard active={inView} /> },
  ];
  return (
    <div ref={ref} className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-8 pt-2 [scrollbar-width:none]">
      {cards.map((c, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.06, duration: 0.5 }}
          className={cx(
            "h-[300px] w-[256px] shrink-0 snap-center overflow-hidden rounded-card p-4",
            c.pink
              ? "bg-[linear-gradient(180deg,#FF9AD0_0%,#FD7BC0_42%,#F34CB0_100%)] text-white shadow-pink-card"
              : "bg-white text-blue shadow-card",
          )}
        >
          {c.node}
        </motion.div>
      ))}
    </div>
  );
}
