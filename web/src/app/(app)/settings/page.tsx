"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, CopyIcon, OutIcon } from "@/components/icons";
import { copyText } from "@/components/money-cards";
import { useOverview } from "@/components/overview";
import { usePrivyLogout } from "@/components/providers";
import { Button, ButtonLink, Card } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";

export default function SettingsPage() {
  const { data } = useOverview();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const privyLogout = usePrivyLogout();
  const router = useRouter();

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    await privyLogout().catch(() => {});
    router.replace("/");
    router.refresh();
  }

  const rows: Array<[string, string]> = data
    ? [
        ["Email", data.me.email],
        ["Sign-in", data.me.authMode === "privy" ? "Email code (Privy)" : "Mock sign-in"],
        ["Money", data.me.moneyMode === "mock" ? "Mock: nothing is signed or broadcast" : data.me.moneyMode === "mainnet" ? "Stellar mainnet (real money)" : "Stellar testnet"],
        ["Naira identity check", data.me.kycStatus === "verified" ? "Passed (number not stored)" : "Not done yet"],
      ]
    : [];

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Settings" />
      <Card className="flex flex-col gap-5 p-6 shadow-soft sm:p-7">
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">Wallet</h2>
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-soft">Stellar address</div>
          {data ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 break-all rounded-2xl bg-mist px-4 py-3 font-mono text-[14px] font-semibold">{data.me.address}</code>
              <Button
                variant="outline-blue"
                size="sm"
                onClick={async () => {
                  if (await copyText(data.me.address)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }
                }}
              >
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : (
            <SkeletonBlock className="mt-2 h-12" />
          )}
        </div>
        <dl className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 py-3.5 text-[14.5px]">
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6 shadow-soft sm:p-7">
        <div>
          <h2 className="text-[18px] font-bold tracking-[-0.03em]">Connected sites</h2>
          <p className="text-[14px] text-muted">Sites Wura may connect to without asking first. It still can’t sign without you.</p>
        </div>
        <ButtonLink href="/settings/sites" variant="outline-blue">Manage sites</ButtonLink>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6 shadow-soft sm:p-7">
        <div>
          <h2 className="text-[18px] font-bold tracking-[-0.03em]">Sign out</h2>
          <p className="text-[14px] text-muted">You can sign back in with the same email.</p>
        </div>
        <Button variant="blue" onClick={signOut} disabled={busy}>
          <OutIcon size={16} /> {busy ? "Signing out…" : "Sign out"}
        </Button>
      </Card>
    </div>
  );
}
