"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckIcon, SparkIcon } from "@/components/icons";
import { Button, Card } from "@/components/ui";

type Info =
  | { ok: true; signedIn: boolean; email: string | null; clientName: string; redirectHost: string; scopes: string[] }
  | { ok: false; error: string };

const CAN: Record<string, string[]> = {
  "wura.read": ["See your balances, limits and recent activity", "Check exchange rates", "See your favourites"],
  "wura.prepare": ["Prepare swaps, sends and payment links for you to review", "Save favourites"],
};

export function Consent() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/oauth/authorize-info?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((i: Info) => {
        if (i.ok && !i.signedIn) {
          router.replace(`/sign-in?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
          return;
        }
        setInfo(i);
      })
      .catch(() => setInfo({ ok: false, error: "Couldn't reach Wura. Try again." }));
  }, [query, router]);

  async function answer(allow: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, allow }),
      });
      const j = (await r.json()) as { redirect?: string; error?: string };
      if (!r.ok || !j.redirect) throw new Error(j.error || "That didn't work.");
      window.location.assign(j.redirect);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-[460px] p-7 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-blue text-white">
          <SparkIcon size={18} />
        </span>
        <span className="text-[18px] font-bold tracking-[-0.02em]">Wura</span>
      </div>
      {!info ? (
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-mist" />
      ) : !info.ok ? (
        <div className="mt-6">
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Can’t connect this app</h1>
          <p className="mt-2 text-[14.5px] text-muted">{info.error}</p>
        </div>
      ) : (
        <>
          <h1 className="mt-6 text-[22px] font-bold leading-tight tracking-[-0.03em]">
            {info.clientName} wants to use your Wura
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            It will send you back to <b className="text-blue">{info.redirectHost}</b>. Signed in as {info.email}.
          </p>
          <div className="mt-5 rounded-2xl bg-mist p-4">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-soft">It can</div>
            <ul className="mt-2 flex flex-col gap-2">
              {info.scopes.flatMap((s) => CAN[s] ?? []).map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[14px]">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-pink text-white">
                    <CheckIcon size={11} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[13.5px] text-muted">
            It <b className="text-blue">can’t move money</b>. Every swap or send waits for your own tap on Approve, and Wura checks your
            limits first. You can disconnect it any time on the Channels page.
          </p>
          {err && <p className="mt-3 text-[13.5px] text-pink-deep">{err}</p>}
          <div className="mt-6 flex gap-2.5">
            <Button variant="outline-blue" className="flex-1" disabled={busy} onClick={() => answer(false)}>
              Don’t allow
            </Button>
            <Button variant="blue" className="flex-1" disabled={busy} onClick={() => answer(true)}>
              {busy ? "Connecting…" : "Allow"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
