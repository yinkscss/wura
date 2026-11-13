"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ChatIcon,
  ClockIcon,
  CloseIcon,
  GaugeIcon,
  GearIcon,
  GlobeIcon,
  GridIcon,
  HomeIcon,
  MenuIcon,
} from "@/components/icons";
import { OverviewProvider, useOverview } from "@/components/overview";
import { Starfield } from "@/components/starfield";
import { Wordmark, cx } from "@/components/ui";

const NAV = [
  { href: "/wallet", label: "Overview", icon: HomeIcon },
  { href: "/chat", label: "Chat", icon: ChatIcon },
  { href: "/activity", label: "Activity", icon: ClockIcon },
  { href: "/limits", label: "Limits", icon: GaugeIcon },
  { href: "/channels", label: "Channels", icon: GridIcon },
  { href: "/settings/sites", label: "Sites", icon: GlobeIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        // The most specific matching item wins (e.g. /settings/sites over /settings).
        const matches = NAV.filter((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
        const best = matches.sort((a, b) => b.href.length - a.href.length)[0];
        const active = best?.href === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cx(
              "relative flex h-12 items-center gap-3.5 rounded-2xl px-4 text-[15.5px] font-medium transition-colors",
              active ? "text-white" : "text-white/80 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-2xl bg-white/[0.13]"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <Icon size={19} className="relative" />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PreviewBadge() {
  const { data } = useOverview();
  const mode = data?.me.moneyMode ?? "mock";
  return (
    <div className="rounded-2xl bg-white/[0.08] px-4 py-3">
      <div className="text-[14px] font-semibold text-white">Example wallet</div>
      <div className="text-[12.5px] text-white/70">
        {mode === "mock" ? "Preview data · not live" : "Stellar testnet"}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isChat = pathname.startsWith("/chat");
  return (
    <OverviewProvider>
      <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[236px_1fr]">
        {/* Desktop sidebar */}
        {/* The blue column stretches the full page height; the menu stays pinned inside it. */}
        <div className="panel-sky relative hidden min-h-dvh lg:block">
          <aside className="sticky top-0 flex h-dvh flex-col overflow-hidden p-5 text-white">
            <Starfield density={1.6} />
            <div className="relative flex h-full flex-col">
              <div className="px-1 pb-8 pt-2">
                <Wordmark href="/wallet" />
              </div>
              <NavList />
              <div className="mt-auto">
                <PreviewBadge />
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile top bar */}
        <div className={cx("panel-sky sticky top-0 z-30 flex items-center justify-between px-4 py-3.5 text-white lg:hidden", isChat && "hidden")}>
          <Wordmark href="/wallet" />
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="grid size-10 place-items-center rounded-full bg-white/10"
          >
            {open ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
          </button>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="panel-sky fixed inset-x-0 top-[68px] z-30 flex flex-col gap-4 p-4 pb-6 text-white shadow-deep lg:hidden"
            >
              <NavList onNavigate={() => setOpen(false)} />
              <PreviewBadge />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="min-w-0">{children}</main>
      </div>
    </OverviewProvider>
  );
}
