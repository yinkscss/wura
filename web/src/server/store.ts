import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { config, moneyLive } from "./config";
import type { TransactionSql } from "postgres";
import { dbEnabled, ensureSchema, sql } from "./db";
import type {
  Activity,
  AllowedSite,
  Balances,
  KycStatus,
  PaymentLink,
  Quote,
  SendIntent,
  SiteAction,
  SiteConnectRequest,
} from "@/lib/types";

/**
 * Wallet state, one record per signed-in user.
 *
 * With DATABASE_URL: stored in Postgres. Every API request runs inside
 * withWallet(), which locks the user's row (SELECT … FOR UPDATE), loads the
 * state, runs the handler and saves it in one transaction. That serialises a
 * user's requests, so two payments at once can't both slip under the daily
 * cap. The transaction log is its own append-only table.
 *
 * Without DATABASE_URL: kept in server memory (mock/demo only). It resets on
 * redeploy, and on Vercel separate instances can each hold their own copy.
 */

export type { Contact } from "@/lib/types";
import type { Contact } from "@/lib/types";

export type PendingTx = {
  id: string;
  kind: "send" | "trustline" | "setup" | "agent-key-on" | "agent-key-off";
  xdr: string;
  hash: string;
  intentId?: string;
  expiresAt: number;
  /** The fully signed transaction, kept once submitted so an unconfirmed submit can be retried safely. */
  signedXdr?: string;
  /** "unconfirmed": submitted but Horizon never said whether it landed. Retrying the same signed XDR can't pay twice. */
  status: "pending" | "submitted" | "unconfirmed" | "failed";
};

export type WalletState = {
  pendingTx: Map<string, PendingTx>;
  balances: Balances;
  /** Lagos calendar day the spend counters belong to, YYYY-MM-DD. */
  spentDay: string;
  spentToday: Balances;
  activity: Activity[];
  quotes: Map<string, Quote>;
  sends: Map<string, SendIntent>;
  links: PaymentLink[];
  contacts: Contact[];
  /** We keep only that a check passed, never the NIN itself. */
  kycStatus: KycStatus;
  /** Sites the user allowed Wura to connect to (not permission to sign). */
  allowList: AllowedSite[];
  siteRequests: Map<string, SiteConnectRequest>;
  siteActions: Map<string, SiteAction>;
  /**
   * One-time codes for the in-chat Approve card (Claude), by send intent id:
   * sha256 hex only. Kept apart from the intent so it never reaches a browser.
   */
  cardCodes: Record<string, string>;
};

const g = globalThis as unknown as { __agentStore?: Map<string, WalletState> };
const store = (g.__agentStore ??= new Map());

export function lagosDay(ts = Date.now()) {
  // Africa/Lagos is UTC+1 all year.
  return new Date(ts + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

/** Obviously fictional placeholder address for example contacts. Not a real account. */
function exampleAddress(name: string) {
  return `GB${name.toUpperCase()}EXAMPLE`.padEnd(56, "X");
}

// Fictional example figures, matching the design mockups.
const T = (iso: string) => Date.parse(iso);

/** Testnet mode starts empty: real balances come from Horizon, no example rows. */
function seedTestnet(): WalletState {
  return {
    pendingTx: new Map(),
    balances: { NGN: 0, USDC: 0 },
    spentDay: lagosDay(),
    spentToday: { NGN: 0, USDC: 0 },
    activity: [],
    quotes: new Map(),
    sends: new Map(),
    links: [],
    // Testnet addresses must never become contacts on mainnet.
    contacts: config.moneyMode === "testnet" ? config.testnetContacts.map((c) => ({ ...c })) : [],
    kycStatus: "none",
    allowList: [],
    siteRequests: new Map(),
    siteActions: new Map(),
    cardCodes: {},
  };
}

function seed(): WalletState {
  const activity: Activity[] = [
    { id: newId("act"), at: T("2026-11-12T17:42:00Z"), kind: "swap", detail: "₦50,000 → 31.20 USDC · Aquarius", amount: "31.20 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-12T15:05:00Z"), kind: "send", detail: "To Tunde", amount: "20.00 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-11T08:14:00Z"), kind: "link", detail: "Payment link created", amount: "₦15,000", status: "open" },
    { id: newId("act"), at: T("2026-11-10T19:31:00Z"), kind: "fund", detail: "USDC received", amount: "200.00 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-10T13:02:00Z"), kind: "swap", detail: "20 USDC → ₦31,980 · SDEX", amount: "₦31,980", status: "done", txRef: "example" },
  ];
  return {
    pendingTx: new Map(),
    balances: { NGN: 182_450_00, USDC: 248_60 },
    spentDay: lagosDay(),
    spentToday: { NGN: 84_000_00, USDC: 0 },
    activity,
    quotes: new Map(),
    sends: new Map(),
    links: [
      {
        id: newId("lnk"),
        code: "8F2K-15K",
        url: "/pay/8F2K-15K",
        address: exampleAddress("You"),
        memo: "8F2K-15K",
        amount: 15_000_00,
        currency: "NGN",
        status: "open",
        createdAt: T("2026-11-11T08:14:00Z"),
        expiresAt: T("2026-11-18T08:14:00Z"),
      },
    ],
    contacts: [
      // Fictional contacts with fictional addresses.
      { name: "Tunde", address: exampleAddress("Tunde") },
      { name: "Ada", address: exampleAddress("Ada") },
      { name: "Chiamaka", address: exampleAddress("Chiamaka") },
    ],
    kycStatus: "none",
    allowList: [
      // Fictional example site on a reserved domain.
      { host: "market.example.org", name: "Example Market", addedAt: T("2026-11-11T10:20:00Z") },
    ],
    siteRequests: new Map(),
    siteActions: new Map(),
    cardCodes: {},
  };
}

type Ctx = { userId: string; w: WalletState };
const als = new AsyncLocalStorage<Ctx>();

function rollDay(w: WalletState) {
  const today = lagosDay();
  if (w.spentDay !== today) {
    w.spentDay = today;
    w.spentToday = { NGN: 0, USDC: 0 };
  }
  return w;
}

function freshWallet() {
  return moneyLive() ? seedTestnet() : seed();
}

/** The signed-in user's wallet state for this request. */
export function wallet(userId: string): WalletState {
  const ctx = als.getStore();
  if (ctx && ctx.userId === userId) return rollDay(ctx.w);
  if (dbEnabled()) {
    throw new Error("wallet() was called outside withWallet(); wrap the handler in authed().");
  }
  let w = store.get(userId);
  if (!w) {
    w = freshWallet();
    store.set(userId, w);
  }
  return rollDay(w);
}

export function resetWallet(userId: string) {
  store.delete(userId);
}

// ---------- Postgres persistence ----------

type Stored = Omit<WalletState, "activity" | "pendingTx" | "quotes" | "sends" | "siteRequests" | "siteActions" | "cardCodes"> & {
  cardCodes?: Record<string, string>;
  pendingTx: Array<[string, PendingTx]>;
  quotes: Array<[string, Quote]>;
  sends: Array<[string, SendIntent]>;
  siteRequests: Array<[string, SiteConnectRequest]>;
  siteActions: Array<[string, SiteAction]>;
};

const DAY = 24 * 60 * 60 * 1000;

/** Drop items (finished or never approved) once they're a couple of days old. */
function prune<T extends { status: string }>(m: Map<string, T>, when: (v: T) => number) {
  const cutoff = Date.now() - 2 * DAY;
  return [...m.entries()].filter(([, v]) => when(v) > cutoff);
}

function serialize(w: WalletState): Stored {
  return {
    balances: w.balances,
    spentDay: w.spentDay,
    spentToday: w.spentToday,
    links: w.links,
    contacts: w.contacts,
    kycStatus: w.kycStatus,
    allowList: w.allowList,
    pendingTx: prune(w.pendingTx, (v) => v.expiresAt),
    quotes: prune(w.quotes, (v) => v.expiresAt),
    sends: prune(w.sends, (v) => v.expiresAt),
    siteRequests: prune(w.siteRequests, (v) => v.createdAt),
    siteActions: prune(w.siteActions, (v) => v.expiresAt),
    // Only codes for sends that are still waiting.
    cardCodes: Object.fromEntries(Object.entries(w.cardCodes ?? {}).filter(([id]) => w.sends.get(id)?.status === "pending")),
  };
}

function deserialize(s: Stored, activity: Activity[]): WalletState {
  return {
    ...s,
    activity,
    pendingTx: new Map(s.pendingTx ?? []),
    quotes: new Map(s.quotes ?? []),
    sends: new Map(s.sends ?? []),
    siteRequests: new Map(s.siteRequests ?? []),
    siteActions: new Map(s.siteActions ?? []),
    allowList: s.allowList ?? [],
    links: s.links ?? [],
    contacts: s.contacts ?? [],
    cardCodes: s.cardCodes ?? {},
  };
}

type ActivityRow = {
  id: string;
  at: Date;
  kind: Activity["kind"];
  detail: string;
  amount: string;
  status: Activity["status"];
  tx_ref: string | null;
  explorer_url: string | null;
};

/**
 * Runs fn with the user's wallet loaded and locked, then saves it. State is
 * saved even when fn throws (e.g. a quote marked expired before refusing),
 * matching the in-memory behaviour, and the error is re-thrown after commit.
 */
export async function withWallet<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (!dbEnabled()) return fn();
  await ensureSchema();
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  await sql().begin(async (tx) => {
    const fresh = freshWallet();
    const inserted = await tx`
      insert into wallets (user_id, state) values (${userId}, ${tx.json(serialize(fresh) as never)})
      on conflict (user_id) do nothing
      returning user_id`;
    if (inserted.length) {
      // New user: write their starting log entries (example rows in mock mode).
      for (const a of fresh.activity) await insertActivity(tx, userId, a);
    }
    const [row] = await tx`select state from wallets where user_id = ${userId} for update`;
    const rows = await tx<ActivityRow[]>`
      select id, at, kind, detail, amount, status, tx_ref, explorer_url
      from activity where user_id = ${userId} order by at desc limit 200`;
    const activity: Activity[] = rows.map((r) => ({
      id: r.id,
      at: new Date(r.at).getTime(),
      kind: r.kind,
      detail: r.detail,
      amount: r.amount,
      status: r.status,
      txRef: r.tx_ref ?? undefined,
      explorerUrl: r.explorer_url ?? undefined,
    }));
    const known = new Set(activity.map((a) => a.id));
    const w = deserialize(row.state as Stored, activity);

    try {
      outcome = { ok: true, value: await als.run({ userId, w }, fn) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    await tx`update wallets set state = ${tx.json(serialize(w) as never)}, version = version + 1, updated_at = now() where user_id = ${userId}`;
    for (const a of w.activity) if (!known.has(a.id)) await insertActivity(tx, userId, a);
  });
  if (!outcome) throw new Error("wallet transaction did not run");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function insertActivity(tx: TransactionSql, userId: string, a: Activity) {
  await tx`
    insert into activity (id, user_id, at, kind, detail, amount, status, tx_ref, explorer_url)
    values (${a.id}, ${userId}, ${new Date(a.at)}, ${a.kind}, ${a.detail}, ${a.amount}, ${a.status}, ${a.txRef ?? null}, ${a.explorerUrl ?? null})
    on conflict (id) do nothing`;
}

/**
 * Finds a payment link by its public code, whoever owns it. Used by the public
 * /pay page and the watcher. Reads without locking (the page never writes).
 * A scan of the wallets table is fine at beta scale; add an index table if it grows.
 */
export async function findLink(code: string): Promise<{ userId: string; link: PaymentLink } | null> {
  if (!dbEnabled()) {
    for (const [userId, w] of g.__agentStore ?? []) {
      const link = w.links.find((l) => l.code === code);
      if (link) return { userId, link: { ...link } };
    }
    return null;
  }
  await ensureSchema();
  const rows = await sql()`
    select w.user_id, l.link
    from wallets w, jsonb_array_elements(w.state->'links') as l(link)
    where l.link->>'code' = ${code}
    limit 1`;
  return rows[0] ? { userId: rows[0].user_id as string, link: rows[0].link as PaymentLink } : null;
}

/** Links worth checking on Horizon: not yet expired, or expired within the last 3 days (so late payments show). */
export async function watchedLinks(now = Date.now()): Promise<Array<{ userId: string; link: PaymentLink }>> {
  const since = now - 3 * DAY;
  if (!dbEnabled()) {
    const out: Array<{ userId: string; link: PaymentLink }> = [];
    for (const [userId, w] of g.__agentStore ?? []) for (const link of w.links) if (link.expiresAt > since) out.push({ userId, link: { ...link } });
    return out;
  }
  await ensureSchema();
  const rows = await sql()`
    select w.user_id, l.link
    from wallets w, jsonb_array_elements(w.state->'links') as l(link)
    where (l.link->>'expiresAt')::bigint > ${since}
    limit 500`;
  return rows.map((r) => ({ userId: r.user_id as string, link: r.link as PaymentLink }));
}

/**
 * Submits that Horizon never confirmed and that have sat for a while. A pending
 * transaction's expiresAt is its creation plus the signing window, so
 * "expired more than `afterMs` ago and still unconfirmed" means stuck.
 * Hashes only: no user ids leave this function.
 */
export async function stuckSubmits(afterMs: number, now = Date.now()): Promise<string[]> {
  const cutoff = now - afterMs;
  if (!dbEnabled()) {
    const out: string[] = [];
    for (const w of g.__agentStore?.values() ?? []) for (const p of w.pendingTx.values()) if (p.status === "unconfirmed" && p.expiresAt < cutoff) out.push(p.hash);
    return out;
  }
  await ensureSchema();
  const rows = await sql()`
    select p.item->1->>'hash' as hash
    from wallets w, jsonb_array_elements(w.state->'pendingTx') as p(item)
    where p.item->1->>'status' = 'unconfirmed' and (p.item->1->>'expiresAt')::bigint < ${cutoff}
    limit 100`;
  return rows.map((r) => String(r.hash));
}
