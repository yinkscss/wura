"use client";

import { useEffect, useRef, useState } from "react";

function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Tweens a number toward `target` whenever it changes (or when `play` turns
 * true). Returns the current value. Honors reduced motion.
 */
export function useAnimatedNumber(
  target: number,
  { duration = 1200, play = true, from }: { duration?: number; play?: boolean; from?: number } = {},
) {
  const [value, setValue] = useState(from ?? target);
  const valueRef = useRef(value);

  useEffect(() => {
    if (!play) return;
    if (prefersReduced()) {
      valueRef.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const v0 = valueRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const v = v0 + (target - v0) * easeOutExpo(k);
      valueRef.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, play]);

  return value;
}
