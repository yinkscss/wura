"use client";

import { useEffect, useRef } from "react";

type Props = {
  className?: string;
  /** Concentrate stars along a half-moon arc, as in the landing design. */
  arc?: boolean;
  /** Stars per 10,000 px². */
  density?: number;
  /** Parallax + constellation lines toward the pointer. */
  interactive?: boolean;
  /** Occasional shooting stars. */
  shooting?: boolean;
  /** Fade the field out toward the bottom (0..1 of height where fade starts). */
  fadeFrom?: number;
};

type Star = {
  x: number; // 0..1
  y: number; // 0..1
  r: number;
  a: number;
  tw: number; // twinkle speed
  ph: number; // twinkle phase
  z: number; // depth 0.2..1 (parallax)
  hue: 0 | 1 | 2; // white, pink, sky
};

type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number };

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeStars(count: number, arc: boolean): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    if (arc && i < count * 0.5) {
      // Points along an upward arc (half-moon), scattered around it.
      const t = Math.random() * Math.PI; // 0..π
      const cx = 0.5;
      const cy = 0.66;
      const rx = 0.44;
      const ry = 0.56;
      x = cx - Math.cos(t) * rx + gaussian() * 0.03;
      y = cy - Math.sin(t) * ry + gaussian() * 0.035;
    } else {
      x = Math.random();
      y = Math.random() ** 1.25; // a little denser near the top
    }
    const big = Math.random() < 0.06;
    stars.push({
      x,
      y,
      r: big ? 1.1 + Math.random() * 1.1 : 0.35 + Math.random() * 0.85,
      a: big ? 0.85 + Math.random() * 0.15 : 0.25 + Math.random() * 0.6,
      tw: 0.4 + Math.random() * 1.6,
      ph: Math.random() * Math.PI * 2,
      z: 0.2 + Math.random() * 0.8,
      hue: Math.random() < 0.05 ? 1 : Math.random() < 0.12 ? 2 : 0,
    });
  }
  return stars;
}

function glowSprite(color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.18, color.replace(/[\d.]+\)$/, "0.55)"));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const COLORS = ["rgba(255,255,255,1)", "rgba(255,170,215,1)", "rgba(190,225,255,1)"];

export function Starfield({
  className,
  arc = false,
  density = 2.2,
  interactive = false,
  shooting = false,
  fadeFrom,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sprites = COLORS.map(glowSprite);
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    let raf = 0;
    let visible = true;
    let running = false;
    const pointer = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4, active: false, px: -9999, py: -9999 };
    const meteors: Meteor[] = [];
    let nextMeteor = performance.now() + 2500 + Math.random() * 3000;
    const start = performance.now();

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(900, Math.round(((w * h) / 10000) * density));
      stars = makeStars(count, arc);
    }

    function draw(now: number) {
      const t = (now - start) / 1000;
      const intro = reduce ? 1 : Math.min(1, t / 1.6);
      ctx!.clearRect(0, 0, w, h);

      // ease pointer
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      const ox = interactive ? (pointer.x - 0.5) * -26 : 0;
      const oy = interactive ? (pointer.y - 0.5) * -16 : 0;

      const near: Array<{ x: number; y: number; d: number }> = [];
      const fadeStart = fadeFrom != null ? fadeFrom * h : Infinity;

      for (const s of stars) {
        const x = s.x * w + ox * s.z;
        const y = s.y * h + oy * s.z;
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        let a = s.a * (reduce ? 1 : 0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
        if (y > fadeStart) a *= Math.max(0, 1 - (y - fadeStart) / (h - fadeStart));
        // reveal from the top of the arc outward
        a *= Math.min(1, intro * 1.4 - Math.abs(s.x - 0.5) * 0.6);
        if (a <= 0.01) continue;

        if (pointer.active) {
          const dx = x - pointer.px;
          const dy = y - pointer.py;
          const d = Math.hypot(dx, dy);
          if (d < 140) {
            a = Math.min(1, a + (1 - d / 140) * 0.7);
            if (s.r > 0.6) near.push({ x, y, d });
          }
        }

        const size = s.r * 7;
        ctx!.globalAlpha = a;
        ctx!.drawImage(sprites[s.hue], x - size / 2, y - size / 2, size, size);
        if (s.r > 1.2) {
          // diffraction spikes on the brightest stars
          ctx!.globalAlpha = a * 0.35;
          ctx!.fillStyle = "#fff";
          ctx!.fillRect(x - s.r * 4, y - 0.35, s.r * 8, 0.7);
          ctx!.fillRect(x - 0.35, y - s.r * 4, 0.7, s.r * 8);
        }
      }

      // constellation lines to the pointer
      if (near.length) {
        near.sort((p, q) => p.d - q.d);
        const pts = near.slice(0, 6);
        ctx!.lineWidth = 0.8;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          ctx!.globalAlpha = (1 - p.d / 140) * 0.45;
          ctx!.strokeStyle = i === 0 ? "rgba(253,145,204,1)" : "rgba(255,255,255,1)";
          ctx!.beginPath();
          ctx!.moveTo(pointer.px, pointer.py);
          ctx!.lineTo(p.x, p.y);
          ctx!.stroke();
          if (i > 0) {
            const q = pts[i - 1];
            ctx!.globalAlpha *= 0.6;
            ctx!.beginPath();
            ctx!.moveTo(q.x, q.y);
            ctx!.lineTo(p.x, p.y);
            ctx!.stroke();
          }
        }
      }

      // shooting stars
      if (shooting && !reduce) {
        if (now > nextMeteor) {
          const fromLeft = Math.random() < 0.5;
          meteors.push({
            x: fromLeft ? w * (0.05 + Math.random() * 0.35) : w * (0.6 + Math.random() * 0.35),
            y: h * (0.02 + Math.random() * 0.25),
            vx: (fromLeft ? 1 : -1) * (7 + Math.random() * 5),
            vy: 2.5 + Math.random() * 2.5,
            life: 0,
            max: 50 + Math.random() * 30,
          });
          nextMeteor = now + 4200 + Math.random() * 6000;
        }
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          m.life++;
          m.x += m.vx;
          m.y += m.vy;
          const k = m.life / m.max;
          const alpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          const tail = 14;
          const grad = ctx!.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
          grad.addColorStop(0, "rgba(255,255,255,0.95)");
          grad.addColorStop(0.3, "rgba(253,145,204,0.45)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          ctx!.globalAlpha = Math.max(0, alpha);
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = 1.6;
          ctx!.lineCap = "round";
          ctx!.beginPath();
          ctx!.moveTo(m.x, m.y);
          ctx!.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
          ctx!.stroke();
          if (m.life >= m.max) meteors.splice(i, 1);
        }
      }
      ctx!.globalAlpha = 1;
    }

    function loop(now: number) {
      draw(now);
      if (visible && !reduce) raf = requestAnimationFrame(loop);
      else running = false;
    }
    function startLoop() {
      if (running || reduce) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }

    resize();
    if (reduce) draw(performance.now());
    else startLoop();

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now());
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && document.visibilityState === "visible";
      if (visible) startLoop();
    });
    io.observe(canvas);
    const onVis = () => {
      visible = document.visibilityState === "visible";
      if (visible) startLoop();
    };
    document.addEventListener("visibilitychange", onVis);

    const host = canvas.parentElement;
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = (e.clientX - rect.left) / rect.width;
      pointer.ty = (e.clientY - rect.top) / rect.height;
      pointer.px = e.clientX - rect.left;
      pointer.py = e.clientY - rect.top;
      pointer.active = e.pointerType === "mouse";
    };
    const onLeave = () => {
      pointer.active = false;
      pointer.tx = 0.5;
      pointer.ty = 0.4;
    };
    if (interactive && host) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (interactive && host) {
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerleave", onLeave);
      }
    };
  }, [arc, density, interactive, shooting, fadeFrom]);

  return <canvas ref={ref} aria-hidden="true" className={className ?? "pointer-events-none absolute inset-0 h-full w-full"} />;
}
