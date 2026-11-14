"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckIcon, CopyIcon, SendIcon, StarIcon, TrashIcon } from "@/components/icons";
import { copyText } from "@/components/money-cards";
import { ButtonLink, Button, Card } from "@/components/ui";
import { PageHeader, SkeletonBlock } from "@/components/wallet-parts";
import { api, ClientApiError } from "@/lib/api";
import type { Contact } from "@/lib/types";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

export default function FavouritesPage() {
  const [list, setList] = useState<Contact[] | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<Contact[]>("/api/contacts"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load your favourites.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const c = await api<Contact>("/api/contacts", { name, address: address.trim() });
      setName("");
      setAddress("");
      setMsg(`Saved ${c.name}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Contact) {
    setMsg(null);
    try {
      await api("/api/contacts/remove", { address: c.address });
      setMsg(`Removed ${c.name}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof ClientApiError ? e.message : "Couldn't remove that. Try again.");
    }
  }

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-7 px-5 py-8 sm:px-8 lg:px-11 lg:py-10">
      <PageHeader title="Favourites" sub="People you send to. Say “send $10 to Isaac” and Wura knows who you mean." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <Card className="flex flex-col gap-3 p-6 shadow-soft sm:p-7">
          <h2 className="mb-1 text-[20px] font-bold tracking-[-0.03em]">Saved</h2>
          {list === null ? (
            <SkeletonBlock className="h-40" />
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-mist px-6 py-10 text-center text-[14.5px] text-muted">
              <span className="grid size-11 place-items-center rounded-2xl bg-white text-blue">
                <StarIcon size={20} />
              </span>
              No favourites yet. Add one here, or send to an address in chat and save it after.
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {list.map((c) => (
                <li key={c.address} className="flex flex-col gap-3 rounded-2xl bg-mist px-4 py-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-blue text-[15px] font-bold text-white">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15.5px] font-semibold">{c.name}</div>
                      <div className="truncate font-mono text-[12.5px] text-muted">{short(c.address)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ButtonLink href={`/chat?draft=${encodeURIComponent(`Send to ${c.name}`)}`} variant="blue" size="sm">
                      <SendIcon size={14} /> Send
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Copy ${c.name}'s address`}
                      onClick={async () => {
                        if (await copyText(c.address)) {
                          setCopied(c.address);
                          setTimeout(() => setCopied(null), 1500);
                        }
                      }}
                    >
                      {copied === c.address ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}>
                      <TrashIcon size={14} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-6 shadow-soft sm:p-7">
          <h2 className="text-[20px] font-bold tracking-[-0.03em]">Add a favourite</h2>
          <form onSubmit={add} className="flex flex-col gap-3">
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
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">Stellar address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="G…"
                autoComplete="off"
                spellCheck={false}
                className="rounded-2xl bg-mist px-4 py-3 font-mono text-[14px] text-blue outline-none placeholder:text-soft"
              />
            </label>
            <Button type="submit" variant="blue" className="w-fit" disabled={busy || !name.trim() || !address.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
          {msg && <p className="text-[13.5px] text-muted">{msg}</p>}
        </Card>
      </div>
    </div>
  );
}
