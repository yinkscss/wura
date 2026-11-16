import "server-only";
import { dbEnabled, ensureSchema, sql } from "./db";

/**
 * Fixed-window counter shared by every server instance when there is a
 * database (an in-process map otherwise). Returns false once `key` has been
 * hit more than `limit` times in the current window.
 */
const g = globalThis as unknown as { __rate?: Map<string, number> };

export async function withinRate(key: string, limit: number, windowSec: number, now = Date.now()): Promise<boolean> {
  const win = Math.floor(now / (windowSec * 1000));
  if (!dbEnabled()) {
    const m = (g.__rate ??= new Map());
    for (const k of m.keys()) if (!k.endsWith(`|${win}`)) m.delete(k);
    const id = `${key}|${win}`;
    const n = (m.get(id) ?? 0) + 1;
    m.set(id, n);
    return n <= limit;
  }
  await ensureSchema();
  const db = sql();
  const [row] = await db<{ count: number }[]>`
    insert into rate_limits (key, window_start, count)
    values (${key}, ${new Date(win * windowSec * 1000)}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (Math.random() < 0.02) await db`delete from rate_limits where window_start < now() - interval '1 hour'`;
  return row.count <= limit;
}
