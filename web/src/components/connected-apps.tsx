"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/api";
import { Button, Card } from "./ui";

type App = { clientId: string; name: string; redirectHost: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** Apps connected through the MCP connector (Claude, ChatGPT), with Disconnect. */
export function ConnectedAppsCard() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApps(await api<App[]>("/api/connected-apps"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load connected apps.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function revoke(a: App) {
    setBusy(a.clientId);
    setMsg(null);
    try {
      await api("/api/connected-apps/revoke", { clientId: a.clientId });
      setMsg(`${a.name} is disconnected. It has to ask again to use your Wura.`);
      await load();
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6 shadow-soft sm:p-7">
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">Connected apps</h2>
        <p className="mt-1 text-[14.5px] text-muted">
          AI apps you’ve let use your Wura, like Claude. They can check balances and prepare payments, but nothing moves until
          you tap Approve.
        </p>
      </div>
      {apps === null ? (
        <div className="h-16 animate-pulse rounded-2xl bg-mist" />
      ) : apps.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-3.5 text-[14px] text-muted">No apps connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {apps.map((a) => (
            <li key={a.clientId} className="flex flex-col gap-3 rounded-2xl bg-mist px-4 py-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-semibold">{a.name}</div>
                <div className="text-[12.5px] text-muted">
                  {a.redirectHost} · connected {day(a.connectedAt)}
                  {a.lastUsedAt ? ` · last used ${day(a.lastUsedAt)}` : ""}
                </div>
              </div>
              <Button variant="outline-blue" size="sm" className="w-fit" disabled={busy === a.clientId} onClick={() => revoke(a)}>
                {busy === a.clientId ? "Disconnecting…" : "Disconnect"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-[13.5px] text-muted">{msg}</p>}
    </Card>
  );
}
