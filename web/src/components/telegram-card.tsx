"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { Button, Card, Pill } from "./ui";

type Status = { enabled: boolean; linked: boolean; botUsername: string | null };

/**
 * Connects this wallet to the Telegram bot. "Connect" makes a single-use link
 * (valid 10 minutes) that opens the bot; the bot links that chat to this user.
 */
export function TelegramCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>("/api/telegram/link"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load Telegram status.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (status && !status.enabled) return null;

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const { url } = await api<{ url: string }>("/api/telegram/link", {});
      window.open(url, "_blank", "noopener,noreferrer");
      setMsg("Telegram should open. Tap Start in the chat. The link works once, for 10 minutes. Then come back and refresh.");
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMsg("Telegram is disconnected. That chat can no longer use your wallet.");
      await load();
    } catch {
      setMsg("That didn't work. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6 shadow-soft sm:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">Telegram</h2>
        {status && <Pill tone={status.linked ? "blue" : "pink"}>{status.linked ? "Connected" : "Not connected"}</Pill>}
      </div>
      <p className="text-[14.5px] text-muted">
        Chat with Wura in Telegram. It uses this same wallet and the same limits. It only prepares payments: money moves when you tap
        Approve, and Wura checks your limits first. Disconnect any time to delete the link.
      </p>
      <div className="flex flex-wrap gap-3">
        {status?.linked ? (
          <Button variant="outline-blue" className="w-fit" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button variant="blue" className="w-fit" onClick={connect} disabled={busy || !status}>
            {busy ? "Making a link…" : "Connect Telegram"}
          </Button>
        )}
        <Button variant="outline-blue" className="w-fit" onClick={() => void load()} disabled={busy}>
          Refresh
        </Button>
      </div>
      {msg && <p className="text-[13.5px] text-muted">{msg}</p>}
    </Card>
  );
}
