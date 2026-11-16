"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { Button, Card, Pill } from "./ui";

type Status = { enabled: boolean; linked: boolean; account: string | null; displayNumber: string | null };

/**
 * Connects this wallet to WhatsApp. "Connect" makes a single-use wa.me link
 * (valid 10 minutes) with a code; sending that code links the number to this user.
 */
export function WhatsAppCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>("/api/whatsapp/link"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load WhatsApp status.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const waiting = Boolean(link && !status?.linked);
  useEffect(() => {
    if (!waiting || !link) return;
    const t = setInterval(() => {
      if (Date.now() > link.expiresAt) setLink(null);
      else void load();
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, link, load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status?.linked && link) setLink(null);
  }, [status?.linked, link]);

  if (status && !status.enabled) return null;

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api<{ url: string; expiresAt: number }>("/api/whatsapp/link", {});
      setLink(next);
      window.open(next.url, "_blank", "noopener,noreferrer");
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
      const res = await fetch("/api/whatsapp/link", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setLink(null);
      setMsg("WhatsApp is disconnected. That number can no longer use your wallet.");
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
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">WhatsApp</h2>
        {status && <Pill tone={status.linked ? "blue" : "pink"}>{status.linked ? "Connected" : "Not connected"}</Pill>}
      </div>
      {status?.linked && (
        <p className="text-[14.5px]">
          Connected to <span className="font-bold text-blue">{status.account ?? "a WhatsApp number"}</span>. Not you? Disconnect now.
        </p>
      )}
      <p className="text-[14.5px] text-muted">
        Chat with Wura in WhatsApp. It uses this same wallet and the same limits. WhatsApp only carries the messages: money
        moves when you tap Approve, and Wura checks your limits first. Disconnect any time to delete the number from Wura.
      </p>
      <div className="flex flex-wrap gap-3">
        {status?.linked ? (
          <Button variant="outline-blue" className="w-fit" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button variant="blue" className="w-fit" onClick={connect} disabled={busy || !status}>
            {busy ? "Making a link…" : "Connect WhatsApp"}
          </Button>
        )}
        <Button variant="outline-blue" className="w-fit" onClick={() => void load()} disabled={busy}>
          Refresh
        </Button>
      </div>
      {link && !status?.linked && (
        <div className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-[14px]">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit rounded-full bg-[#25D366] px-5 py-2.5 font-bold text-white"
          >
            Open WhatsApp
          </a>
          <p className="text-muted">
            Send the pre-filled code in the chat. This link works once, for 10 minutes, and connects whoever sends it, so
            don’t share it. This card updates when you’re connected.
          </p>
        </div>
      )}
      {msg && <p className="text-[13.5px] text-muted">{msg}</p>}
    </Card>
  );
}
