import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deps } from "./reconcile";
import type { TransferRow } from "./records";
import type { TransferStatus } from "./sep24";

delete process.env.DATABASE_URL;

const { historyEntry, logIfEnded, reconcile, RAMP_STUCK_AFTER_MS } = await import("./reconcile");

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function row(over: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "r1",
    userId: "u1",
    address: "GUSER",
    provider: "link",
    service: "NGN",
    kind: "topup",
    anchorTxId: "a1",
    amount: 20_000_00,
    state: "processing",
    anchorStatus: "pending_anchor",
    amountIn: null,
    amountOut: null,
    fee: null,
    stellarTxId: null,
    loggedAt: null,
    flaggedAt: null,
    createdAt: NOW - HOUR,
    ...over,
  };
}

function status(over: Partial<TransferStatus> = {}): TransferStatus {
  return { id: "a1", kind: "deposit", state: "done", anchorStatus: "completed", amountIn: 20_000_00, amountOut: 19_800_00, fee: 200_00, feeAsset: null, amountOutAsset: null, stellarTxId: "abc123", payTo: null, ...over };
}

/** An in-memory stand-in for the two tables, with the same once-only rules as the SQL. */
function world(rows: TransferRow[], opts: { tokens?: Record<string, string>; partner?: Record<string, TransferStatus | Error | null>; failWrites?: number } = {}) {
  const written: Array<{ id: string; detail: string; amount: string; status: string }> = [];
  let failWrites = opts.failWrites ?? 0;
  const open = (r: TransferRow) => r.state === "waiting_for_you" || r.state === "processing";
  const get = (id: string) => rows.find((r) => r.id === id)!;
  const deps: Deps = {
    now: () => NOW,
    open: async () => rows.filter(open).map((r) => ({ ...r })),
    token: async (r) => opts.tokens?.[r.userId] ?? null,
    read: async (r) => {
      const a = opts.partner?.[r.anchorTxId];
      if (a instanceof Error) throw a;
      return a ?? null;
    },
    save: async (r, t) => {
      const cur = get(r.id);
      if (!open(cur)) return;
      Object.assign(cur, { state: t.state, anchorStatus: t.anchorStatus, amountIn: t.amountIn ?? cur.amountIn, amountOut: t.amountOut ?? cur.amountOut, fee: t.fee ?? cur.fee, stellarTxId: t.stellarTxId ?? cur.stellarTxId });
    },
    fresh: async (r) => ({ ...get(r.id) }),
    claim: async (id) => {
      const cur = get(id);
      if (cur.loggedAt !== null) return false;
      cur.loggedAt = NOW;
      return true;
    },
    release: async (id) => {
      get(id).loggedAt = null;
    },
    write: async (r, e) => {
      if (failWrites > 0) {
        failWrites--;
        throw new Error("database is down");
      }
      written.push({ id: r.id, detail: e.detail, amount: e.amount, status: e.status });
    },
    flag: async (id) => {
      const cur = get(id);
      if (cur.flaggedAt !== null || !open(cur)) return false;
      cur.flaggedAt = NOW;
      return true;
    },
    touch: async () => {},
    stuck: async () => {
      const f = rows.filter((r) => open(r) && r.flaggedAt !== null);
      return {
        topups: f.filter((r) => r.kind === "topup").length,
        cashouts: f.filter((r) => r.kind === "cashout").length,
        cashoutsInProgress: f.filter((r) => r.kind === "cashout" && r.state === "processing").length,
        oldest: f.length ? Math.min(...f.map((r) => r.createdAt)) : null,
      };
    },
    purge: async () => 0,
  };
  return { deps, written, rows };
}

test("a finished top-up is closed and written to the history once, however often the job runs", async () => {
  const w = world([row()], { tokens: { u1: "t" }, partner: { a1: status() } });
  const first = await reconcile(w.deps);
  assert.deepEqual({ checked: first.checked, done: first.done, flagged: first.flagged }, { checked: 1, done: 1, flagged: 0 });
  const second = await reconcile(w.deps);
  assert.equal(second.checked, 0);
  assert.equal(w.written.length, 1);
  assert.deepEqual(w.written[0], { id: "r1", detail: "Naira top-up arrived", amount: "₦19,800", status: "done" });
  assert.equal(w.rows[0].state, "done");
});

test("two runs at the same moment still write one history entry", async () => {
  const w = world([row({ state: "done", anchorStatus: "completed", amountOut: 19_800_00 })]);
  const results = await Promise.all([logIfEnded({ ...w.rows[0] }, w.deps), logIfEnded({ ...w.rows[0] }, w.deps), logIfEnded({ ...w.rows[0] }, w.deps)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(w.written.length, 1);
});

test("if the history entry can't be written, the claim is given back and a later run writes it", async () => {
  const w = world([row()], { tokens: { u1: "t" }, partner: { a1: status() }, failWrites: 1 });
  const first = await reconcile(w.deps);
  assert.equal(first.errors, 1);
  assert.equal(w.written.length, 0);
  assert.equal(w.rows[0].loggedAt, null);
  assert.equal(await logIfEnded({ ...w.rows[0] }, w.deps), true);
  assert.equal(w.written.length, 1);
});

test("with no partner sign-in, an old transfer is flagged and never resolved; a recent one is left alone", async () => {
  const old = row({ id: "old", anchorTxId: "a-old", kind: "cashout", createdAt: NOW - RAMP_STUCK_AFTER_MS - HOUR });
  const recent = row({ id: "new", anchorTxId: "a-new" });
  const w = world([old, recent]);
  const r = await reconcile(w.deps);
  assert.deepEqual({ unreadable: r.unreadable, flagged: r.flagged, done: r.done, failed: r.failed }, { unreadable: 2, flagged: 1, done: 0, failed: 0 });
  assert.equal(w.rows[0].state, "processing");
  assert.notEqual(w.rows[0].flaggedAt, null);
  assert.equal(w.rows[1].flaggedAt, null);
  assert.deepEqual(r.stuck, { topups: 0, cashouts: 1, cashoutsInProgress: 1, oldest: old.createdAt });
  assert.equal(w.written.length, 0);
  // A second run doesn't flag it again, and the count stays.
  const again = await reconcile(w.deps);
  assert.equal(again.flagged, 0);
  assert.equal(again.stuck.cashouts, 1);
});

test("a transfer the partner still has open after a day is flagged; when it ends later it is closed and leaves the count", async () => {
  const r0 = row({ createdAt: NOW - RAMP_STUCK_AFTER_MS - HOUR });
  const partner: Record<string, TransferStatus> = { a1: status({ state: "processing", anchorStatus: "pending_external", amountOut: null, stellarTxId: null }) };
  const w = world([r0], { tokens: { u1: "t" }, partner });
  const first = await reconcile(w.deps);
  assert.deepEqual({ open: first.open, flagged: first.flagged, stuck: first.stuck.topups }, { open: 1, flagged: 1, stuck: 1 });
  partner.a1 = status({ state: "failed", anchorStatus: "refunded", amountOut: null, stellarTxId: null });
  const second = await reconcile(w.deps);
  assert.equal(second.failed, 1);
  assert.equal(second.stuck.topups, 0);
  assert.deepEqual(w.written.map((e) => [e.detail, e.status]), [["Naira top-up refunded to your bank account", "refused"]]);
});

test("one transfer the partner can't be reached for doesn't stop the others", async () => {
  const w = world([row({ id: "bad", anchorTxId: "a-bad" }), row({ id: "good", anchorTxId: "a-good" })], {
    tokens: { u1: "t" },
    partner: { "a-bad": new Error("timeout"), "a-good": status({ id: "a-good" }) },
  });
  const r = await reconcile(w.deps);
  assert.deepEqual({ checked: r.checked, errors: r.errors, done: r.done }, { checked: 2, errors: 1, done: 1 });
  assert.equal(w.rows[0].state, "processing");
});

test("history entries use plain words: no partner, token or network names", () => {
  for (const kind of ["topup", "cashout"] as const) {
    for (const service of ["NGN", "USDC"] as const) {
      for (const [state, anchorStatus] of [["done", "completed"], ["failed", "refunded"], ["failed", "expired"], ["failed", "error"]] as const) {
        const e = historyEntry(row({ kind, service, state, anchorStatus, amountIn: 10_000_00, amountOut: 9_900_00 }));
        assert.equal(e.kind, "fund");
        assert.equal(e.status, state === "done" ? "done" : "refused");
        assert.doesNotMatch(e.detail, /LINK|NGNC|anchor|SEP|Stellar|trustline|memo/i);
        assert.ok(e.detail.length > 0);
      }
    }
  }
  const paid = historyEntry(row({ kind: "cashout", state: "done", anchorStatus: "completed", amountIn: 10_000_00, stellarTxId: "deadbeef" }));
  assert.equal(paid.detail, "Cash-out paid to your bank account");
  assert.equal(paid.amount, "₦10,000");
  assert.equal(paid.txRef, "deadbeef");
  assert.match(paid.explorerUrl ?? "", /deadbeef$/);
});
