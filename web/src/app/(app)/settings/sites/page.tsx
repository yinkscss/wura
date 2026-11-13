"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BackIcon, GlobeIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { Button, ButtonLink, Card, Pill } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { api, ClientApiError } from "@/lib/api";
import { day } from "@/lib/format";
import type { AllowedSite, SiteConnectRequest } from "@/lib/types";

type Sites = { allowed: AllowedSite[]; pending: SiteConnectRequest[]; exampleSites: string[] };

export default function SitesPage() {
  const [data, setData] = useState<Sites | null>(null);
  const [host, setHost] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Sites>("/api/sites"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load your sites.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!host.trim()) return;
    void run("add", async () => {
      await api("/api/sites", { host });
      setHost("");
    });
  }

  async function remove(h: string) {
    await run(`rm:${h}`, async () => {
      const res = await fetch("/api/sites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: h }),
      });
      if (!res.ok) throw new Error("Couldn't remove that site.");
    });
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <Link href="/settings" className="flex w-fit items-center gap-1 text-[13.5px] font-semibold text-muted hover:text-blue">
        <BackIcon size={14} /> Settings
      </Link>
      <PageHeader
        title="Connected sites"
        sub="Sites Wura may connect to without asking first. This never lets it sign: every payment still needs your approval."
      />

      {err && <Card className="p-4 text-[14px] font-medium text-pink-deep" role="alert">{err}</Card>}

      {/* Pending "Connect to this site?" */}
      <AnimatePresence>
        {data && data.pending.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="flex flex-col gap-4 p-6 shadow-soft ring-2 ring-pink/60 sm:p-7">
              <div className="flex items-center gap-2">
                <h2 className="text-[20px] font-bold tracking-[-0.03em]">Waiting for your answer</h2>
                <Pill tone="pink">{data.pending.length}</Pill>
              </div>
              <ul className="flex flex-col gap-3">
                {data.pending.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-mist p-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white"><GlobeIcon size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15.5px] font-bold">Connect to {r.host}?</div>
                      <div className="truncate text-[13px] text-muted">
                        {r.want ? `You asked to buy ${r.want}` : "Asked in chat"} · {day(r.createdAt)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline-blue" size="sm" disabled={!!busy} onClick={() => run(`d:${r.id}`, () => api("/api/sites/dismiss", { requestId: r.id }))}>
                        Dismiss
                      </Button>
                      <Button variant="blue" size="sm" disabled={!!busy} onClick={() => run(`a:${r.id}`, () => api("/api/sites", { host: r.host }))}>
                        Allow
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-muted">Allowing a site here doesn’t buy anything. Ask again in chat to get a fresh preview.</p>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="flex flex-col gap-5 p-6 shadow-soft sm:p-7">
        <h2 className="text-[20px] font-bold tracking-[-0.03em]">Allow list</h2>
        {!data ? (
          <SkeletonBlock className="h-24" />
        ) : data.allowed.length === 0 ? (
          <p className="rounded-2xl bg-mist p-5 text-[14px] text-muted">
            No sites yet. When you ask Wura to use a site, it asks “Connect to this site?” and can add it here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            <AnimatePresence initial={false}>
              {data.allowed.map((a) => (
                <motion.li
                  key={a.host}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-4 overflow-hidden py-4"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue/[0.07]"><GlobeIcon size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15.5px] font-bold">{a.host}</div>
                    <div className="truncate text-[13px] text-muted">
                      {a.name !== a.host ? `${a.name} · ` : ""}added {day(a.addedAt)}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${a.host}`} disabled={busy === `rm:${a.host}`} onClick={() => remove(a.host)}>
                    <TrashIcon size={15} /> Remove
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        <form onSubmit={onAdd} className="flex flex-wrap gap-3">
          <label htmlFor="site-host" className="sr-only">Site address</label>
          <input
            id="site-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="tickets.example.com"
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-full bg-mist px-5 text-[15px] font-medium text-blue outline-none placeholder:text-soft focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--color-pink)]"
          />
          <Button type="submit" variant="blue" disabled={busy === "add" || !host.trim()}>Add site</Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-3 p-6 text-[14.5px] text-muted shadow-soft sm:p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-pink/20 text-pink-deep"><ShieldIcon size={18} /></span>
          <h2 className="text-[18px] font-bold tracking-[-0.03em] text-blue">How connecting works</h2>
        </div>
        <ul className="flex flex-col gap-2">
          <li>· Wura reads the site, finds its Soroban contract, checks it’s verified and reads what it does.</li>
          <li>· It simulates the transaction and shows you a plain-language preview. It signs only after you approve.</li>
          <li>· Your spending limits apply, and every payment goes into your log.</li>
          <li>· If the contract can’t be found or verified, or the simulation fails, Wura stops instead of guessing.</li>
        </ul>
        {data && (
          <p className="rounded-2xl bg-mist p-4 text-[13px]">
            Preview mode: Wura can only connect to these fictional example sites: {data.exampleSites.join(", ")}.
          </p>
        )}
        <ButtonLink href={`/chat?prompt=${encodeURIComponent("Connect to tickets.example.com and buy a ticket")}`} variant="outline-blue" className="mt-1 w-fit">
          Try it in chat
        </ButtonLink>
      </Card>
    </div>
  );
}
