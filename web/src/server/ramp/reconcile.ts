import "server-only";
import { money } from "@/lib/format";
import type { Activity } from "@/lib/types";
import { config } from "../config";
import { log } from "../money";
import { wallet, withWallet } from "../store";
import { readLinkTransfer } from "./link";
import { claimLog, findTransfer, flag, openTransfers, purgeSessions, releaseLog, saveStatus, storedToken, stuckTransfers, touch, type Stuck, type TransferRow } from "./records";
import type { TransferStatus } from "./sep24";

/**
 * Keeps stored top-ups and cash-outs in step with the partner
 * (docs/mainnet-plan.md, Otowo's path 4).
 *
 * It runs from /api/funding/reconcile on a schedule, and the history entry is
 * also written when the user looks at a transfer's status. Running it twice,
 * or at the same moment as a status read, is safe: a transfer that has ended
 * is never reopened, and its history entry is written by whoever claims it
 * first (records.ts claimLog), once only.
 *
 * The partner sign-in lasts about a day. Without one this job can't read a
 * transfer, so a transfer still open after a day is flagged as stuck and left
 * for a person; it is never guessed to be done or failed. Nothing here signs
 * or moves money.
 */

/** A transfer still open after this long is flagged. It matches the partner sign-in's lifetime. */
export const RAMP_STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

type Entry = Omit<Activity, "id" | "at">;

/** The history entry for a transfer that has ended. Plain words: no partner or token names. */
export function historyEntry(row: TransferRow): Entry {
  const done = row.state === "done";
  const moved = row.kind === "topup" ? row.amountOut : row.amountIn;
  const detail =
    row.kind === "topup"
      ? done
        ? "Naira top-up arrived"
        : row.anchorStatus === "refunded"
          ? "Naira top-up refunded to your bank account"
          : row.anchorStatus === "expired"
            ? "Naira top-up expired"
            : "Naira top-up didn't go through"
      : done
        ? "Cash-out paid to your bank account"
        : row.anchorStatus === "refunded"
          ? "Cash-out refunded to your wallet"
          : row.anchorStatus === "expired"
            ? "Cash-out expired"
            : "Cash-out didn't go through";
  const entry: Entry = { kind: "fund", detail, amount: money(moved ?? row.amount, row.service), status: done ? "done" : "refused" };
  if (row.stellarTxId) {
    entry.txRef = row.stellarTxId;
    entry.explorerUrl = config.explorerTx(row.stellarTxId);
  }
  return entry;
}

export type Deps = {
  now: () => number;
  open: (limit: number) => Promise<TransferRow[]>;
  /** The stored partner token for this transfer's owner, or null. */
  token: (row: TransferRow) => Promise<string | null>;
  /** What the partner says now. null when the token is no longer accepted. */
  read: (row: TransferRow, token: string) => Promise<TransferStatus | null>;
  save: (row: TransferRow, t: TransferStatus) => Promise<void>;
  fresh: (row: TransferRow) => Promise<TransferRow | null>;
  claim: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
  write: (row: TransferRow, entry: Entry) => Promise<void>;
  flag: (id: string) => Promise<boolean>;
  touch: (id: string) => Promise<void>;
  stuck: () => Promise<Stuck>;
  purge: () => Promise<number>;
};

const key = (row: TransferRow) => ({ provider: row.provider, service: row.service, anchorTxId: row.anchorTxId });

const live: Deps = {
  now: () => Date.now(),
  open: openTransfers,
  token: (row) => storedToken({ userId: row.userId, address: row.address }, row.service),
  read: (row, token) => readLinkTransfer({ service: row.service, account: row.address, token, id: row.anchorTxId, kind: row.kind }),
  save: (row, t) => saveStatus(key(row), t),
  fresh: (row) => findTransfer(key(row)),
  claim: claimLog,
  release: releaseLog,
  write: (row, entry) =>
    withWallet(row.userId, async () => {
      log(wallet(row.userId), entry);
    }),
  flag,
  touch,
  stuck: stuckTransfers,
  purge: purgeSessions,
};

/**
 * Writes the history entry for a stored transfer if it has ended and nobody
 * has written it yet. True when this call wrote it. Must not be called while
 * the user's wallet is already locked (inside authed()).
 */
export async function logIfEnded(row: TransferRow, deps: Deps = live): Promise<boolean> {
  if (row.state !== "done" && row.state !== "failed") return false;
  if (row.loggedAt !== null) return false;
  if (!(await deps.claim(row.id))) return false;
  try {
    await deps.write(row, historyEntry(row));
    return true;
  } catch (err) {
    await deps.release(row.id);
    throw err;
  }
}

/** After a status read by the user: write the history entry if the transfer has just ended. Never throws. */
export async function logAfterStatus(k: { provider: string; service: TransferRow["service"]; anchorTxId: string }): Promise<void> {
  try {
    const row = await findTransfer(k);
    if (row) await logIfEnded(row);
  } catch (err) {
    console.error("[ramp:reconcile] history entry", err instanceof Error ? err.message : "failed");
  }
}

export type ReconcileReport = {
  /** Open transfers looked at this run. */
  checked: number;
  done: number;
  failed: number;
  /** Still open with the partner. */
  open: number;
  /** No partner sign-in to read them with. */
  unreadable: number;
  /** Newly flagged as stuck this run. */
  flagged: number;
  /** The partner or the database couldn't be reached for these. */
  errors: number;
  /** Every open transfer flagged as stuck, now. Alert on these. */
  stuck: Stuck;
};

/** One pass over the open transfers. */
export async function reconcile(deps: Deps = live, limit = 50): Promise<ReconcileReport> {
  const r: Omit<ReconcileReport, "stuck"> = { checked: 0, done: 0, failed: 0, open: 0, unreadable: 0, flagged: 0, errors: 0 };
  for (const row of await deps.open(limit)) {
    r.checked++;
    try {
      const old = deps.now() - row.createdAt > RAMP_STUCK_AFTER_MS;
      const token = await deps.token(row);
      const t = token ? await deps.read(row, token) : null;
      if (!t) {
        r.unreadable++;
        if (old && (await deps.flag(row.id))) r.flagged++;
        await deps.touch(row.id);
        continue;
      }
      await deps.save(row, t);
      if (t.state === "done" || t.state === "failed") {
        const now = await deps.fresh(row);
        if (now) await logIfEnded(now, deps);
        r[t.state]++;
      } else {
        r.open++;
        if (old && (await deps.flag(row.id))) r.flagged++;
      }
    } catch (err) {
      r.errors++;
      // The reason is for us. No token, memo or address is logged.
      console.error("[ramp:reconcile]", row.id, err instanceof Error ? err.message : "failed");
      await deps.touch(row.id).catch(() => {});
    }
  }
  await deps.purge().catch(() => 0);
  return { ...r, stuck: await deps.stuck() };
}
