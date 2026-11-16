import "server-only";
import { randomUUID } from "node:crypto";
import { dbEnabled, ensureSchema, sql } from "../db";
import type { TransferState, TransferStatus } from "./sep24";
import type { RampCurrency } from "./types";
import { seal, unseal } from "./vault";

/**
 * The stored side of the naira partner: partner sign-ins (ramp_sessions) and
 * every top-up and cash-out (ramp_transfers), so a restart loses nothing.
 *
 * Without DATABASE_URL every function here does nothing (mock and demo). No
 * identity or bank details, and no payment memo, are stored. Tokens are stored
 * sealed (./vault.ts) and are never logged.
 */

export type TransferKind = "topup" | "cashout";

export type TransferRow = {
  id: string;
  userId: string;
  address: string;
  provider: string;
  service: RampCurrency;
  kind: TransferKind;
  /** The partner's own id for the transfer. */
  anchorTxId: string;
  /** What was asked for, minor units of `service`. */
  amount: number;
  state: TransferState;
  anchorStatus: string;
  amountIn: number | null;
  amountOut: number | null;
  fee: number | null;
  stellarTxId: string | null;
  /** Unix ms. */
  loggedAt: number | null;
  flaggedAt: number | null;
  createdAt: number;
};

/** The shape of a postgres.js tag. Tests and checks can pass their own. */
type Db = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

const g = globalThis as unknown as { __rampDb?: Db };

/** For tests and local checks: run the queries against another database. */
export function useRampDb(db: Db | undefined) {
  g.__rampDb = db;
}

async function db(): Promise<Db | null> {
  if (g.__rampDb) return g.__rampDb;
  if (!dbEnabled()) return null;
  await ensureSchema();
  return sql() as unknown as Db;
}

// postgres.js returns bigint as a string and timestamptz as a Date.
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ms = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());

function toRow(r: Record<string, unknown>): TransferRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    address: String(r.address),
    provider: String(r.provider),
    service: r.service as RampCurrency,
    kind: r.kind as TransferKind,
    anchorTxId: String(r.anchor_tx_id),
    amount: Number(r.amount),
    state: r.state as TransferState,
    anchorStatus: String(r.anchor_status),
    amountIn: num(r.amount_in),
    amountOut: num(r.amount_out),
    fee: num(r.fee),
    stellarTxId: r.stellar_tx_id === null || r.stellar_tx_id === undefined ? null : String(r.stellar_tx_id),
    loggedAt: ms(r.logged_at),
    flaggedAt: ms(r.flagged_at),
    createdAt: ms(r.created_at) ?? 0,
  };
}

// ---------- Partner sign-ins ----------

/** Stores the partner sign-in, sealed. False when there is no database or no key: the cookie still works. */
export async function saveSession(who: { userId: string; address: string }, service: RampCurrency, p: { token: string; expiresAt: number }): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const s = seal(p.token, { userId: who.userId, service });
  if (!s) return false;
  await d`
    insert into ramp_sessions (user_id, service, address, token_enc, key_version, expires_at, updated_at)
    values (${who.userId}, ${service}, ${who.address}, ${s.sealed}, ${s.keyVersion}, ${new Date(p.expiresAt)}, now())
    on conflict (user_id, service) do update set
      address = excluded.address, token_enc = excluded.token_enc, key_version = excluded.key_version,
      expires_at = excluded.expires_at, updated_at = now()`;
  return true;
}

/** The stored partner token for this user, service and wallet, or null. Rows that are expired or won't open are deleted. */
export async function storedToken(who: { userId: string; address: string }, service: RampCurrency, now = Date.now()): Promise<string | null> {
  const d = await db();
  if (!d) return null;
  const [r] = await d`select address, token_enc, key_version, expires_at from ramp_sessions where user_id = ${who.userId} and service = ${service}`;
  if (!r) return null;
  const token = (ms(r.expires_at) ?? 0) > now && r.address === who.address ? unseal(String(r.token_enc), Number(r.key_version), { userId: who.userId, service }) : null;
  if (!token) await d`delete from ramp_sessions where user_id = ${who.userId} and service = ${service}`;
  return token;
}

/** Removes sign-ins that have expired. Returns how many. */
export async function purgeSessions(): Promise<number> {
  const d = await db();
  if (!d) return 0;
  return (await d`delete from ramp_sessions where expires_at < now() returning user_id`).length;
}

// ---------- Transfers ----------

/** Records a transfer the partner has just opened. Safe to call twice: the partner's id is unique. */
export async function recordTransfer(t: { userId: string; address: string; provider: string; service: RampCurrency; kind: TransferKind; anchorTxId: string; amount: number }): Promise<void> {
  const d = await db();
  if (!d) return;
  await d`
    insert into ramp_transfers (id, user_id, address, provider, service, kind, anchor_tx_id, amount, state, anchor_status)
    values (${randomUUID()}, ${t.userId}, ${t.address}, ${t.provider}, ${t.service}, ${t.kind}, ${t.anchorTxId}, ${t.amount}, 'waiting_for_you', 'incomplete')
    on conflict (provider, service, anchor_tx_id) do nothing`;
}

/**
 * Saves what the partner now says about a transfer. A transfer that has ended
 * is never reopened. A page that was opened and left to expire is marked as
 * already logged, so it never shows up in the user's history.
 */
export async function saveStatus(key: { provider: string; service: RampCurrency; anchorTxId: string }, t: TransferStatus): Promise<void> {
  const d = await db();
  if (!d) return;
  await d`
    update ramp_transfers set
      logged_at = case when anchor_status = 'incomplete' and ${t.anchorStatus} = 'expired' then now() else logged_at end,
      state = ${t.state},
      anchor_status = ${t.anchorStatus},
      amount_in = coalesce(${t.amountIn}::bigint, amount_in),
      amount_out = coalesce(${t.amountOut}::bigint, amount_out),
      fee = coalesce(${t.fee}::bigint, fee),
      stellar_tx_id = coalesce(${t.stellarTxId}::text, stellar_tx_id),
      last_checked_at = now(),
      updated_at = now()
    where provider = ${key.provider} and service = ${key.service} and anchor_tx_id = ${key.anchorTxId}
      and state in ('waiting_for_you', 'processing')`;
}

export async function findTransfer(key: { provider: string; service: RampCurrency; anchorTxId: string }): Promise<TransferRow | null> {
  const d = await db();
  if (!d) return null;
  const [r] = await d`select * from ramp_transfers where provider = ${key.provider} and service = ${key.service} and anchor_tx_id = ${key.anchorTxId}`;
  return r ? toRow(r) : null;
}

/** Transfers that haven't ended, least recently checked first. */
export async function openTransfers(limit = 50): Promise<TransferRow[]> {
  const d = await db();
  if (!d) return [];
  const rows = await d`
    select * from ramp_transfers where state in ('waiting_for_you', 'processing')
    order by last_checked_at nulls first limit ${limit}`;
  return rows.map(toRow);
}

/** A user's latest transfers, newest first, so a screen can pick up after a restart. */
export async function userTransfers(userId: string, limit = 20): Promise<TransferRow[]> {
  const d = await db();
  if (!d) return [];
  const rows = await d`select * from ramp_transfers where user_id = ${userId} order by created_at desc limit ${limit}`;
  return rows.map(toRow);
}

export async function touch(id: string): Promise<void> {
  const d = await db();
  if (d) await d`update ramp_transfers set last_checked_at = now() where id = ${id}`;
}

/**
 * Claims the one right to write this transfer's history entry. True for the
 * first caller only, however many run at once.
 */
export async function claimLog(id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return (await d`update ramp_transfers set logged_at = now() where id = ${id} and logged_at is null returning id`).length === 1;
}

/** Gives the claim back when the history entry couldn't be written, so a later run can. */
export async function releaseLog(id: string): Promise<void> {
  const d = await db();
  if (d) await d`update ramp_transfers set logged_at = null where id = ${id}`;
}

/** Marks an open transfer as stuck. True the first time only. */
export async function flag(id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return (
    (await d`
      update ramp_transfers set flagged_at = now(), updated_at = now()
      where id = ${id} and flagged_at is null and state in ('waiting_for_you', 'processing') returning id`).length === 1
  );
}

export type Stuck = {
  topups: number;
  cashouts: number;
  /** Cash-outs the partner was already working on: money may have left the wallet. These need a person. */
  cashoutsInProgress: number;
  /** Unix ms of the oldest stuck transfer, or null. */
  oldest: number | null;
};

/** How many open transfers are flagged as stuck. For the health check and alerts. */
export async function stuckTransfers(): Promise<Stuck> {
  const out: Stuck = { topups: 0, cashouts: 0, cashoutsInProgress: 0, oldest: null };
  const d = await db();
  if (!d) return out;
  const rows = await d`
    select kind, state, count(*) as n, min(created_at) as oldest from ramp_transfers
    where flagged_at is not null and state in ('waiting_for_you', 'processing')
    group by kind, state`;
  for (const r of rows) {
    const n = Number(r.n);
    if (r.kind === "cashout") {
      out.cashouts += n;
      if (r.state === "processing") out.cashoutsInProgress += n;
    } else out.topups += n;
    const o = ms(r.oldest);
    if (o !== null && (out.oldest === null || o < out.oldest)) out.oldest = o;
  }
  return out;
}
