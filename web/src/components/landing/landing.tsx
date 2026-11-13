"use client";

import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import {
  ChatIcon,
  ClockIcon,
  LinkIcon,
  ListIcon,
  SendIcon,
  ShieldIcon,
  SparkIcon,
  SwapIcon,
  WalletIcon,
} from "../icons";
import { Starfield } from "../starfield";
import { ButtonLink, Wordmark, buttonClass, cx } from "../ui";
import { HeroArc, HeroCardsMobile } from "./hero-arc";
import { HowDemo } from "./how-demo";
import { LimitTester } from "./limit-tester";
import { RoutingViz } from "./routing-viz";

const ease = [0.22, 1, 0.36, 1] as const;

function Nav() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setSolid(v > 40));
  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 transition-[background,box-shadow] duration-300",
        solid ? "bg-blue-deep shadow-[0_8px_30px_rgba(4,18,63,0.35)]" : "bg-transparent",
      )}
    >
      <nav className="mx-auto grid h-[72px] max-w-[1440px] grid-cols-[1fr_auto] items-center px-5 sm:px-12 md:grid-cols-[1fr_auto_1fr]">
        <Wordmark />
        <ul className="hidden items-center gap-7 text-[14px] font-medium text-white/85 md:flex">
          {[
            ["Product", "#product"],
            ["How it works", "#how"],
            ["Safety", "#safety"],
            ["Channels", "#channels"],
          ].map(([label, href]) => (
            <li key={href}>
              <a href={href} className="relative py-1 transition-colors hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-pink after:transition-transform hover:after:scale-x-100">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Link href="/sign-in" className="hidden h-9 items-center px-3 text-[13.5px] font-semibold text-white/85 hover:text-white sm:inline-flex">
            Sign in
          </Link>
          <ButtonLink href="/sign-in" variant="outline" size="sm">
            Get started
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

function Sparkle({ className, delay = 0, size = 18, pink }: { className: string; delay?: number; size?: number; pink?: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cx("pointer-events-none absolute", pink ? "text-pink" : "text-white", className)}
      initial={{ opacity: 0, scale: 0, rotate: -45 }}
      animate={{ opacity: [0, 1, 0.85, 1], scale: [0, 1.2, 0.9, 1], rotate: 0 }}
      transition={{ duration: 1.2, delay, ease }}
    >
      <motion.span className="block" animate={{ rotate: [0, 90, 0], scale: [1, 0.8, 1] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay }}>
        <SparkIcon size={size} />
      </motion.span>
    </motion.span>
  );
}

function Words({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block"
            initial={reduce ? false : { y: "105%", rotate: 4 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ duration: 0.9, delay: delay + i * 0.08, ease }}
          >
            {w}
            {i < text.split(" ").length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);

  return (
    <section ref={ref} className="hero-sky relative overflow-hidden pb-6 text-white md:pb-0">
      <Starfield arc interactive shooting fadeFrom={0.62} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_30%,rgba(90,170,255,0.35),transparent_70%)]" />

      <motion.div style={{ y: copyY, opacity: copyOpacity }} className="relative z-10 px-5 pt-[100px] text-center sm:px-10 md:pt-[96px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] font-medium text-white/80"
        >
          {[
            [SwapIcon, "Swap"],
            [SendIcon, "Send"],
            [LinkIcon, "Payment links"],
            [WalletIcon, "Balances"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof SwapIcon;
            return (
              <span key={label as string} className="inline-flex items-center gap-1.5">
                <I size={14} className="opacity-85" /> {label as string}
              </span>
            );
          })}
        </motion.div>

        <h1 className="relative mx-auto inline-block text-[52px] font-bold leading-[0.96] tracking-[-0.045em] [text-shadow:0_8px_30px_rgba(4,20,80,0.18)] sm:text-[72px] lg:text-[84px]">
          <Words text="Your money," />
          <br />
          <Words text="on chat." delay={0.18} />
          <Sparkle className="-left-8 -top-2" delay={0.9} size={16} />
          <Sparkle className="-right-10 top-6" delay={1.05} size={22} pink />
          <Sparkle className="-left-6 bottom-3" delay={1.2} size={12} />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.55, ease }}
          className="mx-auto mt-5 max-w-[620px] text-[16.5px] leading-[1.55] text-white/85 sm:text-[17px]"
        >
          A smart wallet you message in Claude, ChatGPT, Telegram or WhatsApp. It compares rates across Stellar, shows a preview, and only moves money when you say yes.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7, ease }}
          className="mt-6 flex flex-wrap justify-center gap-3.5"
        >
          <ButtonLink href="/sign-in" size="lg" className="group">
            Get started
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </ButtonLink>
          <a href="#how" className={buttonClass("outline", "lg")}>
            See how it works
          </a>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-3 text-[12px] text-white/60">
          Buildathon preview · not live · example figures
        </motion.p>
      </motion.div>

      <div className="relative z-20 mt-8 hidden px-4 md:block">
        <HeroArc heroRef={ref} />
      </div>
      <div className="relative z-20 mt-10 px-5 md:hidden">
        <HeroCardsMobile />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white" />
    </section>
  );
}

function Section({ id, eyebrow, title, sub, children, className }: { id: string; eyebrow: string; title: ReactNode; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cx("scroll-mt-20 px-5 py-20 sm:px-10 md:py-28", className)}>
      <div className="mx-auto max-w-[1200px]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease }}
          className="mb-12 max-w-[720px]"
        >
          <div className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-pink-deep">{eyebrow}</div>
          <h2 className="text-balance text-[36px] font-bold leading-[1.04] tracking-[-0.045em] sm:text-[52px]">{title}</h2>
          {sub && <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>}
        </motion.div>
        {children}
      </div>
    </section>
  );
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.65, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const SKILLS = [
  { icon: SwapIcon, title: "Swap", ex: "“Change ₦50,000 to dollars”", body: "Naira to USDC and back, at the best rate it finds." },
  { icon: SendIcon, title: "Send", ex: "“Send $20 to Tunde”", body: "Pay people you’ve saved. Inside your limits, after your yes." },
  { icon: LinkIcon, title: "Payment links", ex: "“Payment link for ₦15,000”", body: "A link anyone can pay. You get told when it’s paid." },
  { icon: WalletIcon, title: "Balances", ex: "“How much do I have left?”", body: "Naira, USDC and what’s left of today’s limit." },
];

const SAFETY = [
  { icon: ListIcon, title: "A preview first", body: "Rate, fee, amount and destination, before anything is sent." },
  { icon: ShieldIcon, title: "Your yes, every time", body: "Wura waits for you to approve. Cancel and nothing happens." },
  { icon: ClockIcon, title: "Daily and per-payment caps", body: "You set them. Requests over a cap are refused before signing." },
  { icon: ChatIcon, title: "Everything is logged", body: "Every swap, send and link goes into a log you can check." },
];

const CHANNELS = [
  { name: "Claude", how: "Chat plugin", tile: "bg-blue" },
  { name: "ChatGPT", how: "Chat plugin", tile: "bg-pink" },
  { name: "Telegram", how: "Bot", tile: "bg-blue-mid" },
  { name: "WhatsApp", how: "Bot", tile: "bg-blue-night" },
];

export function Landing() {
  return (
    <div className="overflow-x-clip bg-white text-blue">
      <Nav />
      <Hero />

      <Section
        id="product"
        eyebrow="Product"
        title="Best rate, before anything moves."
        sub="Ask for a swap and Wura quotes SDEX, Soroswap and Aquarius itself, then shows you the winner with the fee included. If a venue can’t be reached, it says so instead of guessing."
      >
        <div className="grid items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
          <Reveal>
            <RoutingViz />
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {SKILLS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.07}>
                <motion.div whileHover={{ y: -4 }} className="flex h-full flex-col gap-3 rounded-card bg-white p-5 shadow-soft ring-1 ring-line">
                  <span className="grid size-10 place-items-center rounded-xl bg-blue/[0.07]">
                    <s.icon size={18} />
                  </span>
                  <div>
                    <h3 className="text-[17px] font-bold tracking-[-0.02em]">{s.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                  <div className="mt-auto text-[13px] font-semibold text-pink-deep">{s.ex}</div>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="how"
        eyebrow="How it works"
        title="Ask. Check the preview. Say yes."
        sub="Try it below. Pick a request and Wura walks through it the way it does in the app."
        className="bg-page"
      >
        <HowDemo />
      </Section>

      <Section
        id="safety"
        eyebrow="Safety"
        title="It can’t go wild with your money."
        sub="Approvals and spending caps are checked on our server before anything is signed. They aren’t just buttons in the app."
      >
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.05fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {SAFETY.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.07}>
                <div className="flex h-full flex-col gap-3 rounded-card bg-white p-5 shadow-soft ring-1 ring-line">
                  <span className="grid size-10 place-items-center rounded-xl bg-pink/20 text-pink-deep">
                    <s.icon size={18} />
                  </span>
                  <h3 className="text-[17px] font-bold tracking-[-0.02em]">{s.title}</h3>
                  <p className="text-[13.5px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <LimitTester />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-card bg-mist p-5">
                <div className="text-[15px] font-bold">USDC: no ID</div>
                <p className="mt-1 text-[13.5px] text-muted">Already hold USDC? Send it in and start straight away.</p>
              </div>
              <div className="rounded-card bg-mist p-5">
                <div className="text-[15px] font-bold">Naira: verify first</div>
                <p className="mt-1 text-[13.5px] text-muted">An identity check before your first naira top-up.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section
        id="channels"
        eyebrow="Channels"
        title="One assistant, wherever you chat."
        sub="Same wallet, same limits and the same yes-before-anything rule in every app. The web app comes first; the chat apps are next."
        className="bg-page"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CHANNELS.map((c, i) => (
            <Reveal key={c.name} delay={i * 0.07}>
              <motion.div whileHover={{ y: -6, rotate: i % 2 ? 1 : -1 }} className="flex flex-col gap-5 rounded-card bg-white p-6 shadow-card">
                <span className={cx("grid size-12 place-items-center rounded-2xl text-white", c.tile)}>
                  <ChatIcon size={20} />
                </span>
                <div>
                  <div className="text-[20px] font-bold tracking-[-0.03em]">{c.name}</div>
                  <div className="text-[14px] text-muted">{c.how} · same assistant</div>
                </div>
                <span className="w-fit rounded-full bg-blue/[0.07] px-3 py-1 text-[11.5px] font-bold uppercase tracking-[0.06em]">Coming next</span>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </Section>

      <section className="relative overflow-hidden px-5 py-24 text-center text-white sm:px-10" style={{ background: "linear-gradient(180deg,#061A58 0%,#08318D 45%,#1E6AE8 100%)" }}>
        <Starfield arc interactive shooting density={1.8} />
        <div className="relative z-10 mx-auto max-w-[720px]">
          <Reveal>
            <h2 className="text-balance text-[40px] font-bold leading-[1.02] tracking-[-0.045em] sm:text-[60px]">Start with USDC. No ID needed.</h2>
            <p className="mx-auto mt-4 max-w-[520px] text-[17px] text-white/85">Sign in with your email and we’ll create your Stellar wallet. Add naira later, after a one-time identity check.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3.5">
              <ButtonLink href="/sign-in" size="lg">Get started</ButtonLink>
              <ButtonLink href="/sign-in?next=/chat" size="lg" variant="outline">Try the chat</ButtonLink>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="bg-blue-night px-5 py-10 text-white/70 sm:px-12">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6">
          <Wordmark />
          <p className="max-w-[560px] text-[13px] leading-relaxed">
            Wura is built for the Stellar Nigeria Buildathon. This is a preview: it isn’t live, no real money moves, and the figures shown are examples.
          </p>
        </div>
      </footer>
    </div>
  );
}
