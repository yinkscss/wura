/**
 * Alerts (M8). Every alert is a log line starting "[ALERT]" (Vercel can filter
 * and notify on that text) and, when ALERT_WEBHOOK_URL is set, a POST of
 * {"text": "..."} to it. That body works as is with a Slack or Discord-compatible
 * incoming webhook. An alert never carries secrets, emails or full addresses.
 * The same alert is sent at most once every 10 minutes per process, so an
 * outage doesn't flood the channel.
 */

export type AlertKind =
  | "submit_failed"
  | "submit_unconfirmed"
  | "horizon_error"
  | "stuck_transfer"
  | "treasury_low"
  | "link_watcher_failed"
  | "rate_limited"
  | "cashout_release_failed";

const REPEAT_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __alertSeen?: Map<string, number> };

type Deps = { fetch?: typeof fetch; now?: number; env?: Record<string, string | undefined> };

/** Returns true when it was sent, false when it was a repeat. Never throws. */
export async function alert(kind: AlertKind, detail: string, key = "", deps: Deps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now();
  const env = deps.env ?? process.env;
  const seen = (g.__alertSeen ??= new Map());
  const id = `${kind}:${key}`;
  const last = seen.get(id);
  if (last !== undefined && now - last < REPEAT_MS) return false;
  seen.set(id, now);
  const line = `${kind}: ${detail}`;
  console.error(`[ALERT] ${line}`);
  const url = (env.ALERT_WEBHOOK_URL || "").trim();
  if (url.startsWith("https://")) {
    try {
      await (deps.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `Wura alert · ${line}` }),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // A broken webhook must never break a payment. The log line above still exists.
    }
  }
  return true;
}

/** For tests. */
export function resetAlerts() {
  g.__alertSeen = new Map();
}
