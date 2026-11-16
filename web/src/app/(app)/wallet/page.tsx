"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Gauge } from "@/components/gauge";
import { TestnetWalletCard } from "@/components/testnet-wallet";
import { useOverview } from "@/components/overview";
import { useAnimatedNumber } from "@/components/use-animated-number";
import { ButtonLink, Card } from "@/components/ui";
import { ActivityTable, ConnectedApps, PageHeader, SkeletonBlock, StatCard } from "@/components/wallet-parts";
import { money, naira, usdc, usdcNumber } from "@/lib/format";

function greeting(h: number) {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function AnimatedNaira({ minor }: { minor: number }) {
  const v = useAnimatedNumber(minor, { from: 0, duration: 1400 });
  return <>{naira(v)}</>;
}
function AnimatedUsdc({ minor }: { minor: number }) {
  const v = useAnimatedNumber(minor, { from: 0, duration: 1400 });
  return <>{usdcNumber(v)}</>;
}

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const },
});

export default function WalletPage() {
  const { data, error } = useOverview();
  const [hello, setHello] = useState("Hello");
  useEffect(() => {
    // Local time is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHello(greeting(new Date().getHours()));
  }, []);

  const l = data?.limits;
  // On testnet only USDC moves, so the dashboard shows USDC limits first.
  const cur = data?.me.moneyMode !== "mock" ? "USDC" : "NGN";
  const usedFrac = l ? l.spentToday[cur] / l.daily[cur] : 0;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader
        title={hello}
        sub={
          data?.me.moneyMode !== "mock"
            ? "Your Stellar testnet wallet. Limits are example amounts."
            : "Example balances and limits, for a single wallet."
        }
        actions={
          <>
            <ButtonLink href="/onboarding" variant="outline-blue">Fund</ButtonLink>
            <ButtonLink href={`/chat?prompt=${encodeURIComponent("Make a payment link for ₦15,000")}`}>New payment link</ButtonLink>
          </>
        }
      />

      {error && <Card className="p-5 text-[14px] text-pink-deep">{error}</Card>}

      <TestnetWalletCard />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <motion.div {...rise(0)}>
          <StatCard
            refreshable
            label="Naira balance"
            foot={data?.me.moneyMode === "testnet" ? "Naira on-ramp isn’t connected yet" : "Available to swap or send"}
          >
            <div className="nums text-[38px] font-bold leading-none tracking-[-0.045em]">
              {data ? <AnimatedNaira minor={data.balances.NGN} /> : <SkeletonBlock className="h-10 w-44" />}
            </div>
          </StatCard>
        </motion.div>
        <motion.div {...rise(1)}>
          <StatCard refreshable label="USDC balance" foot="No ID needed to hold or send USDC">
            <div className="nums flex items-baseline gap-1.5 text-[38px] font-bold leading-none tracking-[-0.045em]">
              {data ? (
                <>
                  <AnimatedUsdc minor={data.balances.USDC} />
                  <span className="text-[16px] font-semibold tracking-normal">USDC</span>
                </>
              ) : (
                <SkeletonBlock className="h-10 w-40" />
              )}
            </div>
          </StatCard>
        </motion.div>
        <motion.div {...rise(2)}>
          <div className="relative flex min-h-[210px] flex-col overflow-hidden rounded-card bg-[linear-gradient(180deg,#FF9AD0_0%,#FD7BC0_42%,#F34CB0_100%)] p-6 text-white shadow-pink-card">
            <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-white/90">Daily limit</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <Gauge value={usedFrac} size={150} play={!!data} />
              <div className="pr-1">
                <div className="nums text-[30px] font-bold leading-none tracking-[-0.04em]">{Math.round(usedFrac * 100)}%</div>
                <div className="mt-1 text-[14px] leading-tight text-white/90">used<br />today</div>
              </div>
            </div>
            <div className="mt-auto text-[13.5px] text-white/90">
              {l ? `${money(l.spentToday[cur], cur)} of ${money(l.daily[cur], cur)} used` : "…"}
            </div>
          </div>
        </motion.div>
        <motion.div {...rise(3)}>
          <StatCard
            label="Per-payment cap"
            foot={
              l
                ? cur === "USDC"
                  ? `Also ${naira(l.perPayment.NGN)} on naira payments · example`
                  : `Also ${usdc(l.perPayment.USDC)} on dollar sends · example`
                : "…"
            }
          >
            <div className="nums text-[38px] font-bold leading-none tracking-[-0.045em]">
              {l ? money(l.perPayment[cur], cur) : <SkeletonBlock className="h-10 w-40" />}
            </div>
          </StatCard>
        </motion.div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        <motion.div {...rise(4)}>
          <Card className="h-full p-6 shadow-soft sm:p-7">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[20px] font-bold tracking-[-0.03em]">Transaction log</h2>
              <a href="/activity" className="text-[13.5px] font-semibold text-muted hover:text-blue">See all</a>
            </div>
            {data ? <ActivityTable rows={data.activity} limit={6} /> : <SkeletonBlock className="h-64" />}
          </Card>
        </motion.div>
        <motion.div {...rise(5)}>
          <Card className="h-full p-6 shadow-soft sm:p-7">
            <h2 className="text-[20px] font-bold tracking-[-0.03em]">Connected apps</h2>
            <p className="mb-4 mt-1 text-[13.5px] text-muted">The same assistant in each app. Web comes first.</p>
            <ConnectedApps />
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
