import "server-only";
import { randomBytes } from "node:crypto";
import type {
  Activity,
  Balances,
  Currency,
  Limits,
  PaymentLink,
  Quote,
  SendIntent,
} from "@/lib/types";
import { money, naira, usdc } from "@/lib/format";
import { config } from "./config";
import { ApiFailure } from "./errors";
import { compareVenues, EXAMPLE_FEE_BPS, marketRate, quoteSource } from "./routing";
import type { Session } from "./session";
import { signAndSubmit } from "./signer";
import { getAccountStatus } from "./stellar";
import { checkDestination, refuseInTestnet, startTestnetSend, usdcBalance } from "./testnet";
import { newId, wallet, type WalletState } from "./store";

/**
 * The money API. Every write goes through here, and here only: the UI never
 * talks to Horizon or a DEX directly.
 *
 * Approve-before-act and the spending limits are enforced in this module, on
 * the server. A swap or send only reaches the signer when:
 *   - the request carries `approve: true` for a quote/preview this user owns,
 *   - that quote/preview is still pending and not expired,
 *   - the amount is within the per-payment cap and what is left of the daily cap,
 *   - the balance covers it.
 */

// Example caps. The real amounts are still open (docs/open-questions.md).
export const EXAMPLE_LIMITS = {
  daily: { NGN: 200_000_00, USDC: 200_00 } as Balances,
  perPayment: { NGN: 75_000_00, USDC: 50_00 } as Balances,
};

/** Example flat fee on a USDC send, in cents. */
export const EXAMPLE_SEND_FEE = 1;

export function limitsFor(w: WalletState): Limits {
  return {
    example: true,
    daily: { ...EXAMPLE_LIMITS.daily },
    perPayment: { ...EXAMPLE_LIMITS.perPayment },
    spentToday: { ...w.spentToday },
    remainingToday: {
      NGN: Math.max(0, EXAMPLE_LIMITS.daily.NGN - w.spentToday.NGN),
      USDC: Math.max(0, EXAMPLE_LIMITS.daily.USDC - w.spentToday.USDC),
    },
  };
}

export function checkLimits(w: WalletState, currency: Currency, amount: number) {
  const cap = EXAMPLE_LIMITS.perPayment[currency];
  if (amount > cap) {
    throw new ApiFailure(
      "LIMIT_PER_PAYMENT",
      `That's over your per-payment cap of ${money(cap, currency)}, so I won't send it.`,
      403,
    );
  }
  const left = EXAMPLE_LIMITS.daily[currency] - w.spentToday[currency];
  if (amount > left) {
    throw new ApiFailure(
      "LIMIT_DAILY",
      `That would go over your daily limit. You have ${money(Math.max(0, left), currency)} left today.`,
      403,
    );
  }
}

export function checkBalance(w: WalletState, currency: Currency, amount: number) {
  if (amount > w.balances[currency]) {
    throw new ApiFailure(
      "INSUFFICIENT_BALANCE",
      `You don't have enough ${currency}. Your balance is ${money(w.balances[currency], currency)}.`,
      403,
    );
  }
}

function requirePositiveInt(n: unknown, field: string): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ApiFailure("BAD_REQUEST", `${field} must be a positive amount.`);
  }
  return n;
}

export function log(w: WalletState, a: Omit<Activity, "id" | "at">) {
  const entry: Activity = { id: newId("act"), at: Date.now(), ...a };
  w.activity.unshift(entry);
  return entry;
}

// ---------- Reads ----------

export async function getBalances(s: Session): Promise<Balances> {
  if (config.moneyMode === "testnet") {
    // Real USDC from Horizon. Naira isn't on testnet: the on-ramp isn't connected.
    const st = await getAccountStatus(s.address).catch(() => null);
    return { NGN: 0, USDC: st?.usdc ?? 0 };
  }
  return { ...wallet(s.userId).balances };
}

export function getLimits(s: Session): Limits {
  return limitsFor(wallet(s.userId));
}

export function getActivity(s: Session): Activity[] {
  return wallet(s.userId).activity.slice(0, 100);
}

export function getPaymentLinks(s: Session): PaymentLink[] {
  return wallet(s.userId).links.slice();
}

// ---------- Swap ----------

/** Refuse a swap up front when it can't fit the caps or the balance. */
export function precheckSwap(s: Session, from: Currency, amountIn: number) {
  refuseInTestnet("Swaps");
  const w = wallet(s.userId);
  checkLimits(w, from, amountIn);
  checkBalance(w, from, amountIn);
}

export async function getQuote(
  s: Session,
  input: { from: Currency; to: Currency; amountIn: number },
): Promise<Quote> {
  const w = wallet(s.userId);
  const amountIn = requirePositiveInt(input.amountIn, "amountIn");
  const pair = `${input.from}>${input.to}`;
  if (pair !== "NGN>USDC" && pair !== "USDC>NGN") {
    throw new ApiFailure("BAD_REQUEST", "Only naira ↔ USDC swaps are supported.");
  }
  const { quoted, unquoted } = await compareVenues({ from: input.from, to: input.to, amountIn });
  if (quoted.length === 0) {
    throw new ApiFailure(
      "NO_VENUES",
      "I couldn't get a price from any venue right now, so there's nothing to approve. Try again in a minute.",
      503,
    );
  }
  const best = quoted[0];
  const live = quoteSource === "live";
  // Compare live prices with the market rate, so a thin pool can't quietly cost the user.
  const ref = live ? await marketRate() : null;
  let vsMarketPct: number | undefined;
  if (ref) {
    const marketOut = input.from === "NGN" ? amountIn / ref.rate : amountIn * ref.rate;
    vsMarketPct = Math.round(((best.amountOut - marketOut) / marketOut) * 1000) / 10;
  }
  const quote: Quote = {
    id: newId("q"),
    from: input.from,
    to: input.to,
    amountIn,
    amountOut: best.amountOut,
    rate: best.rate,
    // Live: each venue's fees are already inside its quote.
    fee: live ? 0 : Math.round((amountIn * EXAMPLE_FEE_BPS) / 10_000),
    venues: quoted,
    unquoted,
    bestVenue: best.venue,
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
    source: quoteSource,
    market: ref ?? undefined,
    vsMarketPct,
  };
  w.quotes.set(quote.id, quote);
  return quote;
}

export async function approveSwap(s: Session, input: { quoteId: string; approve: unknown }) {
  refuseInTestnet("Swaps");
  const w = wallet(s.userId);
  const quote = w.quotes.get(String(input.quoteId));
  if (!quote) throw new ApiFailure("QUOTE_NOT_FOUND", "That quote doesn't exist. Ask for a new one.", 404);
  if (quote.status !== "pending") {
    throw new ApiFailure("ALREADY_USED", "That quote was already used or cancelled.", 409);
  }
  if (Date.now() > quote.expiresAt) {
    quote.status = "expired";
    throw new ApiFailure("QUOTE_EXPIRED", "That quote expired. Prices move, so ask for a fresh one.", 410);
  }
  if (input.approve !== true) {
    throw new ApiFailure("NOT_APPROVED", "Nothing was sent. A swap only goes ahead when you approve it.", 403);
  }
  checkLimits(w, quote.from, quote.amountIn);
  checkBalance(w, quote.from, quote.amountIn);

  const venueName = quote.venues.find((v) => v.best)!.name;
  const signed = await signAndSubmit({
    kind: "swap",
    userAddress: s.address,
    description: `${money(quote.amountIn, quote.from)} → ${money(quote.amountOut, quote.to)} via ${venueName}`,
  });

  quote.status = "approved";
  w.balances[quote.from] -= quote.amountIn;
  w.balances[quote.to] += quote.amountOut;
  w.spentToday[quote.from] += quote.amountIn;
  const entry = log(w, {
    kind: "swap",
    detail: `${money(quote.amountIn, quote.from)} → ${money(quote.amountOut, quote.to)} · ${venueName}`,
    amount: money(quote.amountOut, quote.to),
    status: "done",
    txRef: signed.txRef,
  });
  return { quote, activity: entry, balances: { ...w.balances }, mock: signed.mock };
}

export function cancelQuote(s: Session, quoteId: string) {
  const q = wallet(s.userId).quotes.get(quoteId);
  if (q && q.status === "pending") q.status = "cancelled";
  return { ok: true };
}

// ---------- Send ----------

function findContact(w: WalletState, name: string) {
  const raw = name.trim();
  // A raw Stellar address works as a recipient too.
  if (/^G[A-Z2-7]{55}$/.test(raw)) {
    const saved = w.contacts.find((c) => c.address === raw);
    return saved ?? { name: `${raw.slice(0, 4)}…${raw.slice(-4)}`, address: raw };
  }
  const n = raw.toLowerCase();
  return w.contacts.find((c) => c.name.toLowerCase() === n);
}

/** Step 1: build a preview. Refuses up front if it can't be within limits. */
export async function previewSend(s: Session, input: { to: string; amount: number; asset?: Currency }): Promise<SendIntent> {
  const w = wallet(s.userId);
  const asset: Currency = input.asset ?? "USDC";
  if (asset !== "USDC") throw new ApiFailure("BAD_REQUEST", "Sends are in USDC for now.");
  const amount = requirePositiveInt(input.amount, "amount");
  const contact = findContact(w, String(input.to ?? ""));
  if (!contact) {
    throw new ApiFailure(
      "UNKNOWN_CONTACT",
      `I don't have "${input.to}" saved yet. Add them with their Stellar address first.`,
      404,
    );
  }
  const testnet = config.moneyMode === "testnet";
  // On testnet the network fee is paid in test XLM, not USDC.
  const fee = testnet ? 0 : EXAMPLE_SEND_FEE;
  checkLimits(w, asset, amount);
  let balanceBefore = w.balances[asset];
  if (testnet) {
    balanceBefore = await usdcBalance(s);
    if (amount > balanceBefore) {
      throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough USDC. Your testnet balance is ${usdc(balanceBefore)}.`, 403);
    }
    if (contact.address === s.address) throw new ApiFailure("BAD_REQUEST", "That's your own wallet.");
    await checkDestination(contact.address, contact.name);
  } else {
    checkBalance(w, asset, amount + fee);
  }
  const limits = limitsFor(w);
  const intent: SendIntent = {
    id: newId("snd"),
    to: { name: contact.name, address: contact.address },
    asset,
    amount,
    fee,
    total: amount + fee,
    balanceBefore,
    dailyRemainingAfter: limits.remainingToday[asset] - amount,
    dailyLimit: limits.daily[asset],
    perPaymentCap: limits.perPayment[asset],
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
  };
  w.sends.set(intent.id, intent);
  return intent;
}

/** Step 2: send it. Re-checks everything; the preview is not trusted on its own. */
export async function createSend(s: Session, input: { intentId: string; approve: unknown }) {
  const w = wallet(s.userId);
  const intent = w.sends.get(String(input.intentId));
  if (!intent) throw new ApiFailure("INTENT_NOT_FOUND", "That payment preview doesn't exist. Ask again.", 404);
  if (intent.status !== "pending") {
    throw new ApiFailure("ALREADY_USED", "That payment was already sent or cancelled.", 409);
  }
  if (Date.now() > intent.expiresAt) {
    intent.status = "expired";
    throw new ApiFailure("QUOTE_EXPIRED", "That preview expired. Ask again and I'll prepare a fresh one.", 410);
  }
  if (input.approve !== true) {
    throw new ApiFailure("NOT_APPROVED", "Nothing was sent. A payment only goes ahead when you confirm it.", 403);
  }
  if (config.moneyMode === "testnet") {
    // Builds the real transaction; the user's wallet signs it next.
    return startTestnetSend(s, intent);
  }
  checkLimits(w, intent.asset, intent.amount);
  checkBalance(w, intent.asset, intent.total);

  const signed = await signAndSubmit({
    kind: "send",
    userAddress: s.address,
    description: `${usdc(intent.amount)} to ${intent.to.name}`,
  });

  intent.status = "sent";
  w.balances[intent.asset] -= intent.total;
  w.spentToday[intent.asset] += intent.amount;
  const entry = log(w, {
    kind: "send",
    detail: `To ${intent.to.name}`,
    amount: usdc(intent.amount),
    status: "done",
    txRef: signed.txRef,
  });
  return { status: "done" as const, intent, activity: entry, balances: { ...w.balances }, mock: signed.mock };
}

export function cancelSend(s: Session, intentId: string) {
  const i = wallet(s.userId).sends.get(intentId);
  if (i && i.status === "pending") i.status = "cancelled";
  return { ok: true };
}

// ---------- Payment links ----------

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function linkCode(amount: number, currency: Currency) {
  const b = randomBytes(4);
  const head = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  const whole = Math.round(amount / 100);
  const tail =
    currency === "NGN" && whole >= 1000 && whole % 1000 === 0 ? `${whole / 1000}K` : String(whole).slice(0, 4);
  return `${head}-${tail}`;
}

export function createPaymentLink(s: Session, input: { amount: number; currency?: Currency }): PaymentLink {
  const w = wallet(s.userId);
  const amount = requirePositiveInt(input.amount, "amount");
  const currency: Currency = input.currency === "USDC" ? "USDC" : "NGN";
  const code = linkCode(amount, currency);
  const now = Date.now();
  const link: PaymentLink = {
    id: newId("lnk"),
    code,
    // Reserved example host: this is not a working payment page.
    url: `https://example.com/p/${code}`,
    amount,
    currency,
    status: "open",
    createdAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
  };
  w.links.unshift(link);
  log(w, {
    kind: "link",
    detail: "Payment link created",
    amount: currency === "NGN" ? naira(amount) : usdc(amount),
    status: "open",
  });
  return link;
}
