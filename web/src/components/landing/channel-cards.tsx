"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { ChatGPTLogo, ClaudeLogo, TelegramLogo, WhatsAppLogo } from "../brand-icons";
import { cx } from "../ui";

type Logo = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type Channel = {
  name: string;
  how: string;
  /** Brand colour, used for the logo tile and soft tints only. */
  hex: string;
  Logo: Logo;
  live: boolean;
  ask: string;
  reply: string;
};

// Brand marks and colours match the in-app channels list (wallet-parts.tsx).
const CHANNELS: Channel[] = [
  { name: "Claude", how: "Connector · add in one tap", hex: "#D97757", Logo: ClaudeLogo, live: true, ask: "Change ₦50,000 to dollars", reply: "Aquarius has the best rate. Preview ready." },
  { name: "ChatGPT", how: "Plugin · custom MCP server", hex: "#10A37F", Logo: ChatGPTLogo, live: true, ask: "Send $20 to Tunde", reply: "Preview ready. Approve it in Wura." },
  { name: "Telegram", how: "Bot · link it from your wallet", hex: "#26A5E4", Logo: TelegramLogo, live: true, ask: "How much do I have left?", reply: "₦84,000 and 31.20 USDC." },
  { name: "WhatsApp", how: "Bot · same assistant", hex: "#25D366", Logo: WhatsAppLogo, live: false, ask: "Payment link for ₦15,000", reply: "Coming soon to WhatsApp." },
];

const ease = [0.22, 1, 0.36, 1] as const;

export function ChannelCards() {
  return (
    // Phones: a swipeable row. sm–lg: two columns. xl: one row of four.
    <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-6 pt-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
      {CHANNELS.map((c, i) => (
        <ChannelCard key={c.name} c={c} i={i} />
      ))}
    </div>
  );
}

function ChannelCard({ c, i }: { c: Channel; i: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.65, delay: i * 0.08, ease }}
      whileHover={reduce ? undefined : { y: -6 }}
      className={cx(
        "group relative flex w-[280px] shrink-0 snap-center flex-col overflow-hidden rounded-card-lg bg-white shadow-card ring-1 ring-line sm:w-auto",
        !c.live && "bg-white/80",
      )}
    >
      {/* brand-tinted header with a big watermark of the logo */}
      <div
        className="relative h-[118px] overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${c.hex}2e 0%, ${c.hex}0f 55%, transparent 100%)` }}
      >
        <span
          aria-hidden="true"
          className="absolute -right-6 -top-6 transition-transform duration-700 ease-out group-hover:-rotate-12 group-hover:scale-110"
          style={{ color: c.hex, opacity: 0.16 }}
        >
          <c.Logo size={150} />
        </span>
        <StatusPill live={c.live} />
      </div>
      {/* logo tile straddles the header edge; outside the header so it isn't clipped */}
      <span
        className={cx("absolute left-6 top-[90px] grid size-14 place-items-center rounded-2xl text-white ring-4 ring-white", !c.live && "saturate-[.55]")}
        style={{ background: c.hex, boxShadow: `0 12px 24px ${c.hex}59` }}
      >
        <c.Logo size={28} />
      </span>

      <div className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-11">
        <div>
          <h3 className="text-[21px] font-bold tracking-[-0.03em]">{c.name}</h3>
          <p className="mt-0.5 text-[13.5px] text-muted">{c.how}</p>
        </div>

        {/* a one-line example of the chat, in that app's colour */}
        <div className={cx("flex flex-col gap-1.5 text-[12.5px] leading-snug", !c.live && "opacity-60")} aria-label={`Example: ${c.ask}`}>
          <span className="ml-auto max-w-[88%] rounded-[14px] rounded-br-[5px] px-3 py-2 font-semibold text-blue" style={{ background: `${c.hex}24` }}>
            {c.ask}
          </span>
          <span className="max-w-[88%] rounded-[14px] rounded-bl-[5px] bg-mist px-3 py-2 text-muted">
            <span className="mr-1 font-bold text-blue">Wura</span>
            {c.reply}
          </span>
        </div>

        <div className="mt-auto pt-1">
          {c.live ? (
            <Link
              href="/sign-in?next=/channels"
              className="inline-flex items-center gap-1.5 text-[14px] font-bold text-blue transition-colors hover:text-pink-deep"
            >
              Connect {c.name}
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </Link>
          ) : (
            <span className="text-[14px] font-semibold text-soft">Same wallet, coming next</span>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return live ? (
    <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-pink-deep shadow-soft">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-pink opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-pink-deep" />
      </span>
      Live
    </span>
  ) : (
    <span className="absolute right-4 top-4 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted shadow-soft">
      Soon
    </span>
  );
}
