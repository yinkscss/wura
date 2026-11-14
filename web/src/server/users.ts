import "server-only";
import { dbEnabled, ensureSchema, sql } from "./db";
import type { Session } from "./session";

/**
 * Who each user is (email and Stellar address), by user_id. Written on every
 * sign-in so chat channels, which have no cookie, can build a Session from the
 * current values. Without DATABASE_URL it lives in memory (demo only).
 */

const g = globalThis as unknown as { __wuraUsers?: Map<string, Session> };
const memory = (g.__wuraUsers ??= new Map());

export async function upsertUser(s: Session): Promise<void> {
  if (!s.userId || !s.address) return;
  if (!dbEnabled()) {
    memory.set(s.userId, { userId: s.userId, email: s.email, address: s.address });
    return;
  }
  await ensureSchema();
  await sql()`
    insert into users (user_id, email, address) values (${s.userId}, ${s.email}, ${s.address})
    on conflict (user_id) do update set email = excluded.email, address = excluded.address, updated_at = now()`;
}

/** The user's current Session, or null if they have never signed in (or have no address). */
export async function getUser(userId: string): Promise<Session | null> {
  if (!dbEnabled()) return memory.get(userId) ?? null;
  await ensureSchema();
  const [row] = await sql()<{ user_id: string; email: string; address: string }[]>`
    select user_id, email, address from users where user_id = ${userId}`;
  return row && row.address ? { userId: row.user_id, email: row.email, address: row.address } : null;
}
