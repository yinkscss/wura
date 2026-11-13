import "server-only";
import { randomBytes } from "node:crypto";
import type {
  Activity,
  Balances,
  KycStatus,
  PaymentLink,
  Quote,
  SendIntent,
} from "@/lib/types";

/**
 * In-memory wallet state for mock mode, one record per signed-in user.
 *
 * This is preview data only. It lives in the server process, so it resets on
 * redeploy, and on Vercel separate serverless instances can each hold their
 * own copy. Swap this module for a database before anything real runs.
 */

export type Contact = { name: string; address: string };

export type WalletState = {
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

function seed(): WalletState {
  const activity: Activity[] = [
    { id: newId("act"), at: T("2026-11-12T17:42:00Z"), kind: "swap", detail: "₦50,000 → 31.20 USDC · Aquarius", amount: "31.20 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-12T15:05:00Z"), kind: "send", detail: "To Tunde", amount: "20.00 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-11T08:14:00Z"), kind: "link", detail: "Payment link created", amount: "₦15,000", status: "open" },
    { id: newId("act"), at: T("2026-11-10T19:31:00Z"), kind: "fund", detail: "USDC received", amount: "200.00 USDC", status: "done", txRef: "example" },
    { id: newId("act"), at: T("2026-11-10T13:02:00Z"), kind: "swap", detail: "20 USDC → ₦31,980 · SDEX", amount: "₦31,980", status: "done", txRef: "example" },
  ];
  return {
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
        url: "https://example.com/p/8F2K-15K",
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
  };
}

export function wallet(userId: string): WalletState {
  let w = store.get(userId);
  if (!w) {
    w = seed();
    store.set(userId, w);
  }
  const today = lagosDay();
  if (w.spentDay !== today) {
    w.spentDay = today;
    w.spentToday = { NGN: 0, USDC: 0 };
  }
  return w;
}

export function resetWallet(userId: string) {
  store.delete(userId);
}
