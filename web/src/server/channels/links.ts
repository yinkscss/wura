import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { dbEnabled, ensureSchema, sql } from "../db";

/**
 * Shared channel ↔ Wura user links for Telegram and WhatsApp: one-time link
 * codes, per-external-id rate limit, message dedupe and short chat history.
 *
 * Keyed by (channel, external_id). Email and wallet address are never stored
 * here; they come from `users` when a Session is built. History can include
 * amounts and names from the chat; unlinking deletes it.
 *
 * Postgres when DATABASE_URL is set. Without it, in-memory maps (demo only).
 */

export type Channel = "telegram" | "whatsapp";

export type HistoryLine = { role: "user" | "agent"; text: string };

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const RATE_LIMIT_PER_MINUTE = 20;
const HISTORY_KEEP = 8;

type MemLink = { userId: string; history: HistoryLine[]; label: string };
type Mem = {
  links: Map<string, MemLink>;
  codes: Map<string, { userId: string; expiresAt: number }>;
  rate: Map<string, number>;
  dedupe: Map<string, number>;
};
const g = globalThis as unknown as { __wuraChannels?: Mem };
const mem = (g.__wuraChannels ??= { links: new Map(), codes: new Map(), rate: new Map(), dedupe: new Map() });

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const linkKey = (channel: Channel, externalId: string) => `${channel}:${externalId}`;
const codeKey = (channel: Channel, codeHash: string) => `${channel}:${codeHash}`;
const cleanLabel = (v: unknown, max = 128) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");

/** Single-use code for deep links (url-safe). */
export async function createLinkCode(channel: Channel, userId: string): Promise<{ code: string; expiresAt: number }> {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + LINK_CODE_TTL_MS;
  const h = hash(code);
  if (!dbEnabled()) {
    for (const [k, v] of mem.codes) {
      if (v.expiresAt < Date.now() || (k.startsWith(`${channel}:`) && v.userId === userId)) mem.codes.delete(k);
    }
    mem.codes.set(codeKey(channel, h), { userId, expiresAt });
    return { code, expiresAt };
  }
  await ensureSchema();
  const db = sql();
  await db`delete from channel_link_codes where channel = ${channel} and (user_id = ${userId} or expires_at < now())`;
  await db`insert into channel_link_codes (channel, code_hash, user_id, expires_at) values (${channel}, ${h}, ${userId}, ${new Date(expiresAt)})`;
  return { code, expiresAt };
}

/**
 * Uses a link code: returns the user_id, or null if unknown, expired or already
 * used. Then links that user to this external id on this channel, replacing any
 * earlier link for either side.
 */
export async function consumeLinkCode(
  channel: Channel,
  code: string,
  externalId: string,
  label = "",
): Promise<string | null> {
  const id = externalId.trim();
  if (!id) return null;
  const h = hash(code);
  const shown = cleanLabel(label) || id;
  if (!dbEnabled()) {
    const c = mem.codes.get(codeKey(channel, h));
    mem.codes.delete(codeKey(channel, h));
    if (!c || c.expiresAt < Date.now()) return null;
    for (const [k, l] of mem.links) {
      if (k.startsWith(`${channel}:`) && l.userId === c.userId) mem.links.delete(k);
    }
    mem.links.set(linkKey(channel, id), { userId: c.userId, history: [], label: shown });
    return c.userId;
  }
  await ensureSchema();
  return sql().begin(async (tx) => {
    const [row] = await tx<{ user_id: string }[]>`
      delete from channel_link_codes
      where channel = ${channel} and code_hash = ${h} and expires_at > now()
      returning user_id`;
    if (!row) return null;
    await tx`delete from channel_links where channel = ${channel} and (user_id = ${row.user_id} or external_id = ${id})`;
    await tx`insert into channel_links (channel, external_id, user_id, label)
      values (${channel}, ${id}, ${row.user_id}, ${shown})`;
    return row.user_id;
  });
}

export async function linkedUserId(channel: Channel, externalId: string): Promise<string | null> {
  const id = externalId.trim();
  if (!id) return null;
  if (!dbEnabled()) return mem.links.get(linkKey(channel, id))?.userId ?? null;
  await ensureSchema();
  const [row] = await sql()<{ user_id: string }[]>`
    select user_id from channel_links where channel = ${channel} and external_id = ${id}`;
  return row?.user_id ?? null;
}

export async function isLinked(channel: Channel, userId: string): Promise<boolean> {
  return (await linkedAccount(channel, userId)) !== null;
}

/** The account linked to this user on this channel, or null. */
export async function linkedAccount(channel: Channel, userId: string): Promise<{ label: string } | null> {
  if (!dbEnabled()) {
    const l = [...mem.links.entries()].find(([k, v]) => k.startsWith(`${channel}:`) && v.userId === userId);
    return l ? { label: l[1].label || "connected" } : null;
  }
  await ensureSchema();
  const [row] = await sql()<{ label: string | null }[]>`
    select label from channel_links where channel = ${channel} and user_id = ${userId}`;
  return row ? { label: row.label || "connected" } : null;
}

/** Deletes the link and its history. Returns whether anything was removed. */
export async function unlinkUser(channel: Channel, userId: string): Promise<boolean> {
  if (!dbEnabled()) {
    let removed = false;
    for (const [k, l] of mem.links) {
      if (k.startsWith(`${channel}:`) && l.userId === userId) removed = mem.links.delete(k) || removed;
    }
    return removed;
  }
  await ensureSchema();
  const rows = await sql()`delete from channel_links where channel = ${channel} and user_id = ${userId} returning 1`;
  return rows.length > 0;
}

export async function getHistory(channel: Channel, externalId: string): Promise<HistoryLine[]> {
  const id = externalId.trim();
  if (!dbEnabled()) return [...(mem.links.get(linkKey(channel, id))?.history ?? [])];
  await ensureSchema();
  const [row] = await sql()<{ history: HistoryLine[] }[]>`
    select history from channel_links where channel = ${channel} and external_id = ${id}`;
  return Array.isArray(row?.history) ? row.history : [];
}

export async function addToHistory(channel: Channel, externalId: string, lines: HistoryLine[]): Promise<void> {
  const id = externalId.trim();
  const prev = await getHistory(channel, id);
  const next = [...prev, ...lines].slice(-HISTORY_KEEP);
  if (!dbEnabled()) {
    const l = mem.links.get(linkKey(channel, id));
    if (l) l.history = next;
    return;
  }
  await sql()`update channel_links set history = ${sql().json(next as never)}
    where channel = ${channel} and external_id = ${id}`;
}

/** Counts this message against the external id's minute. False means over the limit. */
export async function allowMessage(
  channel: Channel,
  externalId: string,
  limit = RATE_LIMIT_PER_MINUTE,
): Promise<boolean> {
  const id = externalId.trim();
  const minute = Math.floor(Date.now() / 60_000);
  if (!dbEnabled()) {
    const key = `${channel}:${id}:${minute}`;
    for (const k of mem.rate.keys()) if (!k.endsWith(`:${minute}`)) mem.rate.delete(k);
    const n = (mem.rate.get(key) ?? 0) + 1;
    mem.rate.set(key, n);
    return n <= limit;
  }
  await ensureSchema();
  const db = sql();
  const [row] = await db<{ count: number }[]>`
    insert into channel_rate (channel, external_id, window_start, count)
    values (${channel}, ${id}, ${new Date(minute * 60_000)}, 1)
    on conflict (channel, external_id, window_start) do update set count = channel_rate.count + 1
    returning count`;
  if (Math.random() < 0.02) await db`delete from channel_rate where window_start < now() - interval '1 hour'`;
  return row.count <= limit;
}

/** True the first time a message id is seen; false for provider retries. */
export async function firstSight(channel: Channel, messageId: string): Promise<boolean> {
  const mid = messageId.trim();
  if (!mid) return false;
  if (!dbEnabled()) {
    const key = `${channel}:${mid}`;
    for (const [k, at] of mem.dedupe) if (at < Date.now() - 24 * 3600_000) mem.dedupe.delete(k);
    if (mem.dedupe.has(key)) return false;
    mem.dedupe.set(key, Date.now());
    return true;
  }
  await ensureSchema();
  const db = sql();
  const rows = await db`
    insert into channel_dedupe (channel, message_id) values (${channel}, ${mid})
    on conflict do nothing returning message_id`;
  if (Math.random() < 0.02) await db`delete from channel_dedupe where at < now() - interval '1 day'`;
  return rows.length > 0;
}
