"use client";

import { useAnimatedNumber } from "./use-animated-number";

const TICKS = 37; // every 6th is long
const START = 210; // degrees, 0 = 3 o'clock, counter-clockwise
const SWEEP = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)] as const;
}

/**
 * Tick gauge from the design (pink daily-limit card). `value` is 0..1.
 * Ticks up to the value are lit; the needle points at the value.
 */
export function Gauge({
  value,
  size = 220,
  play = true,
  label,
  className,
  needleColor = "#fff",
  hub = "#F34CB0",
}: {
  value: number;
  size?: number;
  play?: boolean;
  /** Small number shown at the top near the needle tip. */
  label?: string;
  className?: string;
  needleColor?: string;
  hub?: string;
}) {
  const v = useAnimatedNumber(Math.max(0, Math.min(1, value)), { duration: 1600, play, from: 0 });
  const w = 220;
  const h = 170;
  const cx = 110;
  const cy = 105;
  const angle = START - SWEEP * v;
  const [nx, ny] = polar(cx, cy, 49, angle);
  const [lx, ly] = polar(cx, cy, 88, START - SWEEP * Math.max(0.04, Math.min(0.96, v)));

  return (
    <svg
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {Array.from({ length: TICKS }, (_, i) => {
        const f = i / (TICKS - 1);
        const deg = START - SWEEP * f;
        const long = i % 6 === 0;
        const [x1, y1] = polar(cx, cy, long ? 58 : 64, deg);
        const [x2, y2] = polar(cx, cy, 73, deg);
        const lit = f <= v + 0.0001;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={lit ? "#fff" : "rgba(255,255,255,0.42)"}
            strokeWidth={long ? 2.2 : 1.3}
            strokeLinecap="round"
            style={{ transition: "stroke 200ms" }}
          />
        );
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5.5} fill={needleColor} />
      <circle cx={cx} cy={cy} r={2.4} fill={hub} />
      {label != null && (
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fff"
          fontSize="11"
          fontWeight="700"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {label}
        </text>
      )}
    </svg>
  );
}
