"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { useCompleteSigning } from "@/lib/signing";
import type { ChatApprovalStatus, NeedsSignature } from "@/lib/types";
import { useOverview } from "./overview";
import { Button, Card, Pill } from "./ui";

type Ready = { status: "ready"; chatApproval?: ChatApprovalStatus };

/**
 * Testnet only: lets chat apps (Telegram, Claude) approve sends. Turning it on
 * adds Wura's agent key as a second signer on the user's Stellar account,
 * signed once by their own wallet. Turning it off removes it.
 */
export function ChatApprovalsCard() {
  const { data } = useOverview();
  const completeSigning = useCompleteSigning();
  const [status, setStatus] = useState<ChatApprovalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const testnet = data?.me.moneyMode === "testnet";

  const load = useCallback(async () => {
    try {
      setStatus(await api<ChatApprovalStatus>("/api/chat-approvals"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't reach Stellar testnet.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (testnet) void load();
  }, [testnet, load]);

  if (!testnet) return null;

  async function toggle(on: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<Ready | NeedsSignature>(`/api/chat-approvals/${on ? "enable" : "disable"}`, {});
      await completeSigning<Ready>(res);
      await load();
      setMsg(on ? "Chat approvals are on." : "Chat approvals are off. The agent key is removed from your wallet.");
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "That didn't finish. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  const active = !!status?.active;

  return (
    <Card className="flex flex-col gap-4 p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">Approve from chat apps</h2>
        {status?.available && <Pill tone={active ? "blue" : "pink"}>{active ? "On" : "Off"}</Pill>}
      </div>
      {status && !status.available ? (
        <p className="text-[14.5px] text-muted">Chat approvals aren’t set up on this server yet.</p>
      ) : (
        <>
          <p className="text-[14.5px] text-muted">
            Lets you tap Approve in Telegram or Claude to send testnet USDC, without opening this page. Your wallet adds a Wura key
            that can only make payments. It can’t change your wallet or add signers, and Wura still checks your limits
            before every payment. You can turn it off any time.
          </p>
          <Button variant={active ? "outline-blue" : "blue"} className="w-fit" onClick={() => toggle(!active)} disabled={busy || !status}>
            {busy ? (active ? "Turning off…" : "Turning on…") : active ? "Turn off" : "Turn on"}
          </Button>
        </>
      )}
      {msg && <p className="text-[13.5px] text-muted">{msg}</p>}
    </Card>
  );
}
