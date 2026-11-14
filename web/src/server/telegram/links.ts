import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { dbEnabled, ensureSchema, sql } from "../db";

/**
 * Telegram ↔ Wura user links, one-time link codes, per-user rate limit, update
 * dedupe and short chat history.
 *
 * Postgres when DATABASE_URL is set (so the rate limit and history hold across
 * serverless instances). Without it, in-memory maps (demo only), like store.ts.
 * Against a Telegram id we store the user_id, the Telegram handle (shown on the
 * Channels card) and the last few chat lines. Email and address are read from
 * `users` when a Session is built, so they can't go stale. Chat history can
 * include amounts, names and addresses; unlinking deletes it.
 */

/** Who linked, from Telegram's `from` field. Shown to the user on the web. */
export type TelegramWho = { username?: string; name?: string };

const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);


export type HistoryLine = { role: "user" | "agent"; text: string };

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const RATE_LIMIT_PER_MINUTE = 20;
const HISTORY_KEEP = 8;

type Mem = {
  links: Map<number, { userId: string; history: HistoryLine[]; who: TelegramWho }>;
  codes: Map<string, { userId: string; expiresAt: number }>;
  rate: Map<string, number>;
  updates: Map<number, number>;
};
const g = globalThis as unknown as { __wuraTelegram?: Mem };
const mem = (g.__wuraTelegram ??= { links: new Map(), codes: new Map(), rate: new Map(), updates: new Map() });

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** Single-use code for `t.me/<bot>?start=<code>` (url-safe, ≤ 64 chars). */
export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: number }> {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + LINK_CODE_TTL_MS;
  if (!dbEnabled()) {
    for (const [k, v] of mem.codes) if (v.expiresAt < Date.now() || v.userId === userId) mem.codes.delete(k);
    mem.codes.set(hash(code), { userId, expiresAt });
    return { code, expiresAt };
  }
  await ensureSchema();
  const db = sql();
  // One live code per user; drop expired ones while we're here.
  await db`delete from telegram_link_codes where user_id = ${userId} or expires_at < now()`;
  await db`insert into telegram_link_codes (code_hash, user_id, expires_at) values (${hash(code)}, ${userId}, ${new Date(expiresAt)})`;
  return { code, expiresAt };
}

/**
 * Uses a link code: returns the user it belongs to, or null if unknown,
 * expired or already used. Then links that user to this Telegram account,
 * replacing any earlier link for either side.
 */
export async function consumeLinkCode(code: string, telegramUserId: number, who: TelegramWho = {}): Promise<string | null> {
  const key = hash(code);
  const username = clean(who.username, 64);
  const name = clean(who.name, 128);
  if (!dbEnabled()) {
    const c = mem.codes.get(key);
    mem.codes.delete(key);
    if (!c || c.expiresAt < Date.now()) return null;
    for (const [tid, l] of mem.links) if (l.userId === c.userId) mem.links.delete(tid);
    mem.links.set(telegramUserId, { userId: c.userId, history: [], who: { username, name } });
    return c.userId;
  }
  await ensureSchema();
  return sql().begin(async (tx) => {
    // delete … returning makes the code single use even under concurrent taps.
    const [row] = await tx<{ user_id: string }[]>`
      delete from telegram_link_codes where code_hash = ${key} and expires_at > now() returning user_id`;
    if (!row) return null;
    await tx`delete from telegram_links where user_id = ${row.user_id} or telegram_user_id = ${telegramUserId}`;
    await tx`insert into telegram_links (telegram_user_id, user_id, tg_username, tg_name)
      values (${telegramUserId}, ${row.user_id}, ${username ?? null}, ${name ?? null})`;
    return row.user_id;
  });
}

export async function linkedUserId(telegramUserId: number): Promise<string | null> {
  if (!dbEnabled()) return mem.links.get(telegramUserId)?.userId ?? null;
  await ensureSchema();
  const [row] = await sql()<{ user_id: string }[]>`select user_id from telegram_links where telegram_user_id = ${telegramUserId}`;
  return row?.user_id ?? null;
}

export async function isLinked(userId: string): Promise<boolean> {
  return (await linkedAccount(userId)) !== null;
}

/** The Telegram account linked to this user, or null. `label` is "@handle", a name, or "a Telegram account". */
export async function linkedAccount(userId: string): Promise<{ label: string } | null> {
  const label = (w: TelegramWho) => (w.username ? `@${w.username}` : w.name || "a Telegram account");
  if (!dbEnabled()) {
    const l = [...mem.links.values()].find((x) => x.userId === userId);
    return l ? { label: label(l.who) } : null;
  }
  await ensureSchema();
  const [row] = await sql()<{ tg_username: string | null; tg_name: string | null }[]>`
    select tg_username, tg_name from telegram_links where user_id = ${userId}`;
  return row ? { label: label({ username: row.tg_username ?? undefined, name: row.tg_name ?? undefined }) } : null;
}

/** Deletes the link and its history. Returns whether anything was removed. */
export async function unlinkUser(userId: string): Promise<boolean> {
  if (!dbEnabled()) {
    let removed = false;
    for (const [tid, l] of mem.links) if (l.userId === userId) removed = mem.links.delete(tid) || removed;
    return removed;
  }
  await ensureSchema();
  const rows = await sql()`delete from telegram_links where user_id = ${userId} returning 1`;
  return rows.length > 0;
}

export async function getHistory(telegramUserId: number): Promise<HistoryLine[]> {
  if (!dbEnabled()) return [...(mem.links.get(telegramUserId)?.history ?? [])];
  await ensureSchema();
  const [row] = await sql()<{ history: HistoryLine[] }[]>`select history from telegram_links where telegram_user_id = ${telegramUserId}`;
  return Array.isArray(row?.history) ? row.history : [];
}

/** Appends one exchange and keeps the last few lines. */
export async function addToHistory(telegramUserId: number, lines: HistoryLine[]): Promise<void> {
  const prev = await getHistory(telegramUserId);
  const next = [...prev, ...lines].slice(-HISTORY_KEEP);
  if (!dbEnabled()) {
    const l = mem.links.get(telegramUserId);
    if (l) l.history = next;
    return;
  }
  await sql()`update telegram_links set history = ${sql().json(next as never)} where telegram_user_id = ${telegramUserId}`;
}

/** Counts this message against the user's minute. False means over the limit. */
export async function allowMessage(telegramUserId: number, limit = RATE_LIMIT_PER_MINUTE): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  if (!dbEnabled()) {
    const key = `${telegramUserId}:${minute}`;
    for (const k of mem.rate.keys()) if (!k.endsWith(`:${minute}`)) mem.rate.delete(k);
    const n = (mem.rate.get(key) ?? 0) + 1;
    mem.rate.set(key, n);
    return n <= limit;
  }
  await ensureSchema();
  const db = sql();
  const [row] = await db<{ count: number }[]>`
    insert into telegram_rate (telegram_user_id, window_start, count)
    values (${telegramUserId}, ${new Date(minute * 60_000)}, 1)
    on conflict (telegram_user_id, window_start) do update set count = telegram_rate.count + 1
    returning count`;
  if (Math.random() < 0.02) await db`delete from telegram_rate where window_start < now() - interval '1 hour'`;
  return row.count <= limit;
}

/** True the first time an update_id is seen; false for Telegram's retries. */
export async function firstSight(updateId: number): Promise<boolean> {
  if (!dbEnabled()) {
    for (const [id, at] of mem.updates) if (at < Date.now() - 24 * 3600_000) mem.updates.delete(id);
    if (mem.updates.has(updateId)) return false;
    mem.updates.set(updateId, Date.now());
    return true;
  }
  await ensureSchema();
  const db = sql();
  const rows = await db`insert into telegram_updates (update_id) values (${updateId}) on conflict do nothing returning update_id`;
  if (Math.random() < 0.02) await db`delete from telegram_updates where at < now() - interval '1 day'`;
  return rows.length > 0;
}
