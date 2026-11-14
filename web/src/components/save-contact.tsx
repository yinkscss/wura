"use client";

import { useState, type FormEvent } from "react";
import { api, ClientApiError } from "@/lib/api";
import type { Contact } from "@/lib/types";
import { CheckIcon } from "./icons";
import { Button } from "./ui";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Chat follow-up after a send to a new address: save it under a name. */
export function SaveContactCard({ address }: { address: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await api<Contact>("/api/contacts", { name, address });
      setSaved(c.name);
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="flex items-center gap-3 text-[14.5px]">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-pink text-white">
          <CheckIcon size={13} />
        </span>
        <span>
          Saved as <b>{saved}</b>. Next time just say “send $10 to {saved}”.
        </span>
      </div>
    );
  }
  if (skipped) return <p className="text-[14px] text-muted">Not saved. You can add favourites any time on the Favourites page.</p>;

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div>
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-soft">Save to favourites</div>
        <div className="mt-1 font-mono text-[13px] text-muted">{short(address)}</div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Isaac"
          maxLength={30}
          autoComplete="off"
          className="rounded-2xl bg-mist px-4 py-3 text-[16px] text-blue outline-none placeholder:text-soft"
        />
      </label>
      {err && <p className="text-[13.5px] text-pink-deep">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="blue" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline-blue" onClick={() => setSkipped(true)} disabled={busy}>
          Not now
        </Button>
      </div>
    </form>
  );
}
