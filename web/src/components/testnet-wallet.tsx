"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { useCompleteSigning } from "@/lib/signing";
import type { NeedsSignature, WalletStatus } from "@/lib/types";
import { naira, usdc } from "@/lib/format";
import { CheckIcon, CopyIcon } from "./icons";
import { copyText } from "./money-cards";
import { useOverview } from "./overview";
import { Button, Card, Pill, cx } from "./ui";

/** Live networks (testnet, mainnet): set up the wallet and show real balances. */
export function TestnetWalletCard() {
  const { data, refresh } = useOverview();
  const completeSigning = useCompleteSigning();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<WalletStatus>("/api/wallet/status"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't reach Stellar.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data?.me.moneyMode && data.me.moneyMode !== "mock") void load();
  }, [data?.me.moneyMode, load]);

  if (!data || data.me.moneyMode === "mock") return null;
  const mainnet = data.me.moneyMode === "mainnet";

  async function setup() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ status: "ready"; wallet: WalletStatus } | NeedsSignature>("/api/wallet/setup", {});
      const done = await completeSigning<{ status: "ready"; wallet: WalletStatus }>(res);
      setStatus(done.wallet);
      setMsg(mainnet ? "Your wallet is ready." : "Your testnet wallet is ready for USDC.");
      void refresh();
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "Setup didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { label: status?.sponsored ? "Account activated by Wura (no XLM needed)" : "Test XLM for network fees (Friendbot)", done: !!status?.exists },
    { label: "USDC trustline, signed by your wallet", done: !!status?.hasTrustline },
    ...(status?.needsNgnc ? [{ label: "Naira (NGNC) trustline, signed by your wallet", done: !!status.hasNgncTrustline }] : []),
  ];

  return (
    <Card className="flex flex-col gap-5 p-6 shadow-soft ring-2 ring-pink/40 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[20px] font-bold tracking-[-0.03em]">{mainnet ? "Your Wura wallet" : "Stellar testnet wallet"}</h2>
          <Pill tone={status?.ready ? "blue" : "pink"}>{status?.ready ? "Ready" : "Needs setup"}</Pill>
        </div>
        <span className="text-[13px] text-muted">
          Signed by {data.me.signer === "privy" ? "your Privy wallet" : "a dev test key (server-dev)"}
        </span>
      </div>

      {status && (
        <div className="flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 break-all rounded-2xl bg-mist px-4 py-3 font-mono text-[13px] font-semibold">{status.address}</code>
          <Button
            variant="outline-blue"
            size="sm"
            onClick={async () => {
              if (await copyText(status.address)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {!status?.ready ? (
        <>
          <ul className="flex flex-col gap-2.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 text-[14.5px]">
                <span className={cx("grid size-6 place-items-center rounded-full", s.done ? "bg-pink text-white" : "bg-line text-transparent")}>
                  <CheckIcon size={13} />
                </span>
                {s.label}
              </li>
            ))}
          </ul>
          <Button variant="blue" className="w-fit" onClick={setup} disabled={busy || !status}>
            {busy ? "Setting up…" : mainnet ? "Set up my wallet" : "Set up testnet wallet"}
          </Button>
        </>
      ) : (
        <div className={cx("grid gap-4", status.needsNgnc ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          <div className="rounded-2xl bg-mist p-4">
            <div className="text-[12.5px] text-soft">{mainnet ? "USDC" : "USDC (testnet)"}</div>
            <div className="nums text-[22px] font-bold tracking-[-0.03em]">{usdc(status.usdc ?? 0)}</div>
          </div>
          {status.needsNgnc && (
            <div className="rounded-2xl bg-mist p-4">
              <div className="text-[12.5px] text-soft">Naira (NGNC)</div>
              <div className="nums text-[22px] font-bold tracking-[-0.03em]">{naira(status.ngn ?? 0)}</div>
            </div>
          )}
          <div className="rounded-2xl bg-mist p-4">
            <div className="text-[12.5px] text-soft">XLM for fees</div>
            <div className="nums text-[22px] font-bold tracking-[-0.03em]">{Number(status.xlm).toFixed(2)}</div>
          </div>
          <div className="rounded-2xl bg-mist p-4 text-[13.5px] text-muted">
            {mainnet ? (
              <>Send USDC or naira (NGNC) to this address to add money. Wura pays the network setup, so you never need to buy XLM.</>
            ) : status.usingCircleUsdc ? (
              <>
                Get test USDC from{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-semibold text-pink-deep underline">
                  Circle’s faucet
                </a>{" "}
                (pick Stellar testnet, paste your address).
              </>
            ) : (
              <>
                This deployment uses a private test USDC. Mint some with <code className="font-mono text-[12px]">npm run testnet -- mint &lt;address&gt; 50</code>.
              </>
            )}
          </div>
        </div>
      )}
      {msg && <p className="text-[13.5px] font-medium text-muted" role="status">{msg}</p>}
      <p className="text-[12.5px] text-soft">{mainnet ? "Swaps are not live yet." : "Testnet only. Test USDC and XLM have no value. Swaps stay simulated until live quotes are wired."}</p>
    </Card>
  );
}
