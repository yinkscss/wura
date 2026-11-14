import "server-only";
import { dbEnabled, ensureSchema, sql } from "./db";
import type { Session } from "./session";

/**
 * The users table: user_id → current email and Stellar address.
 *
 * Browser requests carry these in the session cookie. Channels without a
 * cookie (the Telegram bot, the MCP connector) look the user up here by
 * user_id instead, so they always get the current address. Written on every
 * sign-in, and refreshed when the app loads (/api/overview), so people who
 * signed in before this table existed get a row too.
 */

type Row = { user_id: string; email: string; address: string };

const g = globalThis as unknown as { __wuraUsers?: Map<string, Session>; __wuraUsersSeen?: Map<string, string> };
const memory = (g.__wuraUsers ??= new Map());
// Skip repeat writes for the same user/email/address within this process.
const seen = (g.__wuraUsersSeen ??= new Map());

export async function recordUser(s: Session) {
  if (!s.userId || !s.address) return;
  const key = `${s.email}|${s.address}`;
  if (seen.get(s.userId) === key) return;
  if (dbEnabled()) {
    await ensureSchema();
    await sql()`
      insert into users (user_id, email, address, updated_at)
      values (${s.userId}, ${s.email}, ${s.address}, now())
      on conflict (user_id) do update set email = excluded.email, address = excluded.address, updated_at = now()`;
  } else {
    memory.set(s.userId, { userId: s.userId, email: s.email, address: s.address });
  }
  seen.set(s.userId, key);
}

/** The session for a user_id, or null if they've never signed in. */
export async function sessionForUser(userId: string): Promise<Session | null> {
  if (!dbEnabled()) return memory.get(userId) ?? null;
  await ensureSchema();
  const [row] = await sql()<Row[]>`select user_id, email, address from users where user_id = ${userId}`;
  return row ? { userId: row.user_id, email: row.email, address: row.address } : null;
}
