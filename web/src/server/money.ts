import "server-only";
import { randomBytes } from "node:crypto";
import type {
  Activity,
  Balances,
  Currency,
  Limits,
  PaymentLink,
  PaymentMemo,
  Contact,
  Quote,
  SendIntent,
  SiteAction,
  SiteConnectRequest,
} from "@/lib/types";
import { money, naira, usdc } from "@/lib/format";
import { chatApprovalsAvailable, chatApprovalStatus, sendWithAgentKey } from "./agent-key";
import { config, serverDevSigning, moneyLive, onMainnet } from "./config";
import { minReceived, swapPolicy } from "./swap-rules";
import { refuseSwapOffMainnet, startLiveSwap } from "./swaps";
import { ApiFailure } from "./errors";
import { capPercent, scaleCap } from "./ops";
import { compareVenues, EXAMPLE_FEE_BPS, marketRate, quoteSource } from "./routing";
import type { Session } from "./session";
import { signAndSubmit } from "./signer";
import { assetFor, getAccountStatus, isValidAccount } from "./stellar";
import { assetBalance, checkDestination, startTestnetSend } from "./testnet";
import { newId, wallet, type WalletState } from "./store";
import { assertInvited } from "./treasury";

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

// Example caps (docs/open-questions.md), scaled down by CAP_PERCENT (25% on mainnet unless set; D5).
const CAP_PCT = capPercent(process.env, config.stellarNetwork === "mainnet");
export const EXAMPLE_LIMITS = {
  daily: { NGN: scaleCap(200_000_00, CAP_PCT), USDC: scaleCap(200_00, CAP_PCT) } as Balances,
  perPayment: { NGN: scaleCap(75_000_00, CAP_PCT), USDC: scaleCap(50_00, CAP_PCT) } as Balances,
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
  if (moneyLive()) {
    // Real balances from Horizon: USDC, and NGNC (naira) on mainnet. Naira doesn't exist on testnet.
    const st = await getAccountStatus(s.address).catch(() => null);
    return { NGN: st?.ngn ?? 0, USDC: st?.usdc ?? 0 };
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

/** Refuse a swap up front when it can't fit the caps or the balance (the real balance on a live network). */
export async function precheckSwap(s: Session, from: Currency, amountIn: number) {
  refuseSwapOffMainnet();
  const w = wallet(s.userId);
  checkLimits(w, from, amountIn);
  if (moneyLive()) {
    assertInvited(s.email);
    const bal = await assetBalance(s, from);
    if (amountIn > bal) {
      throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough ${from === "NGN" ? "naira" : "USDC"}. Your balance is ${money(bal, from)}.`, 403);
    }
  } else {
    checkBalance(w, from, amountIn);
  }
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
  // On mainnet a swap runs on the Stellar DEX only, so that's the price you approve. The others are shown to compare.
  const executable = onMainnet();
  let best = quoted[0];
  let note: string | undefined;
  if (executable) {
    const sdex = quoted.find((v) => v.venue === "sdex");
    if (!sdex) {
      throw new ApiFailure("NO_VENUES", "The Stellar DEX has no price for this right now, and it's where swaps run, so there's nothing to approve. Try again in a minute.", 503);
    }
    for (const v of quoted) v.best = v === sdex;
    quoted.sort((a, b) => Number(b.best) - Number(a.best) || b.amountOut - a.amountOut);
    best = sdex;
    if (quoted.length > 1 && quoted[1].amountOut > sdex.amountOut) {
      note = `Swaps run on the Stellar DEX for now. ${quoted[1].name} shows a better price, but it can't be used yet.`;
    }
  }
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
    createdAt: Date.now(),
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
    ...(executable ? { executesOn: "sdex" as const, minOut: minReceived(best.amountOut, swapPolicy().slippageBps) } : {}),
    ...(note ? { note } : {}),
  };
  w.quotes.set(quote.id, quote);
  return quote;
}

export async function approveSwap(s: Session, input: { quoteId: string; approve: unknown }) {
  refuseSwapOffMainnet();
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
  // Mainnet: the user's wallet signs a real Stellar DEX swap next.
  if (moneyLive()) return startLiveSwap(s, quote);
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

function findContact(w: WalletState, name: string): SendIntent["to"] | undefined {
  const raw = name.trim();
  // A raw Stellar address works as a recipient too.
  if (/^G[A-Z2-7]{55}$/.test(raw)) {
    const saved = w.contacts.find((c) => c.address === raw);
    return saved ? { ...saved, saved: true } : { name: shortAddr(raw), address: raw, saved: false };
  }
  const n = raw.toLowerCase();
  const c = w.contacts.find((c) => c.name.toLowerCase() === n);
  return c ? { ...c, saved: true } : undefined;
}

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// ---------- Favourites (saved recipients) ----------

const MAX_CONTACTS = 100;

export function listContacts(s: Session): Contact[] {
  return wallet(s.userId).contacts.map((c) => ({ ...c }));
}

/**
 * Saves a recipient under a name, so "send $10 to Isaac" works. Saving the
 * same address again renames it. A name can only point at one address.
 */
export function saveContact(s: Session, input: { name: unknown; address: unknown }): Contact {
  const w = wallet(s.userId);
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  const address = String(input.address ?? "").trim();
  if (!/^[\p{L}][\p{L}\p{N} .'-]{0,29}$/u.test(name)) {
    throw new ApiFailure("BAD_REQUEST", "Give them a name of up to 30 letters, like Isaac or Mum.");
  }
  if (!/^G[A-Z2-7]{55}$/.test(address) || !isValidAccount(address)) {
    throw new ApiFailure("BAD_REQUEST", "That isn't a valid Stellar address. It starts with G and is 56 characters.");
  }
  const sameName = w.contacts.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (sameName && sameName.address !== address) {
    throw new ApiFailure("BAD_REQUEST", `You already have ${sameName.name} saved with a different address. Pick another name or remove that one first.`, 409);
  }
  const existing = w.contacts.find((c) => c.address === address);
  if (existing) {
    existing.name = name;
    return { ...existing };
  }
  if (w.contacts.length >= MAX_CONTACTS) {
    throw new ApiFailure("BAD_REQUEST", `You can save up to ${MAX_CONTACTS} favourites. Remove one first.`, 409);
  }
  const c: Contact = { name, address };
  w.contacts.push(c);
  return { ...c };
}

export function removeContact(s: Session, address: unknown) {
  const w = wallet(s.userId);
  const a = String(address ?? "");
  const before = w.contacts.length;
  w.contacts = w.contacts.filter((c) => c.address !== a);
  return { removed: before !== w.contacts.length };
}

/** Step 1: build a preview. Refuses up front if it can't be within limits. */
export async function previewSend(s: Session, input: { to: string; amount: number; asset?: Currency; memo?: PaymentMemo }): Promise<SendIntent> {
  assertInvited(s.email);
  const w = wallet(s.userId);
  const asset: Currency = input.asset ?? "USDC";
  // Naira (NGNC) moves only on a live network that has it (mainnet). Mock mode stays USDC.
  if (asset !== "USDC" && !moneyLive()) throw new ApiFailure("BAD_REQUEST", "Sends are in USDC for now.");
  const memo = moneyLive() ? cleanMemo(input.memo) : undefined;
  const amount = requirePositiveInt(input.amount, "amount");
  const contact = findContact(w, String(input.to ?? ""));
  if (!contact) {
    throw new ApiFailure(
      "UNKNOWN_CONTACT",
      `I don't have "${input.to}" in your favourites yet. Send to their Stellar address once and I'll offer to save them, or add them on the Favourites page.`,
      404,
    );
  }
  const intent: SendIntent = { id: newId("snd"), createdAt: Date.now(), ...(await sendFigures(s, w, contact, asset, amount, memo)) };
  w.sends.set(intent.id, intent);
  return intent;
}

/** Runs every check for a send and returns fresh numbers. Throws on any refusal. */
/** Checks a memo the sender typed. Text is at most 28 bytes; an id is a whole number that fits in 64 bits. */
export function cleanMemo(m: PaymentMemo | undefined): PaymentMemo | undefined {
  if (!m || String(m.value ?? "").trim() === "") return undefined;
  const value = String(m.value).trim();
  const bad = (msg: string) => new ApiFailure("BAD_REQUEST", msg, 400);
  if (m.type === "id") {
    if (!/^\d{1,20}$/.test(value) || BigInt(value) > BigInt("18446744073709551615")) throw bad("That memo number isn't valid.");
    return { type: "id", value };
  }
  if (Buffer.byteLength(value, "utf8") > 28) throw bad("A memo can be 28 characters at most.");
  return { type: "text", value };
}

async function sendFigures(s: Session, w: WalletState, contact: SendIntent["to"], asset: Currency, amount: number, memo?: PaymentMemo): Promise<Omit<SendIntent, "id">> {
  const testnet = moneyLive();
  // With real money the network fee is paid in XLM, not USDC.
  const fee = testnet ? 0 : EXAMPLE_SEND_FEE;
  checkLimits(w, asset, amount);
  let balanceBefore = w.balances[asset];
  if (testnet) {
    if (contact.address === s.address) throw new ApiFailure("BAD_REQUEST", "That's your own wallet.");
    balanceBefore = await assetBalance(s, asset);
    if (amount > balanceBefore) {
      throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough ${asset === "NGN" ? "naira" : "USDC"}. Your balance is ${money(balanceBefore, asset)}.`, 403);
    }
    await checkDestination(contact.address, contact.name, asset, memo);
  } else {
    checkBalance(w, asset, amount + fee);
  }
  const limits = limitsFor(w);
  return {
    to: { name: contact.name, address: contact.address, saved: contact.saved },
    asset,
    ...(memo ? { memo } : {}),
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
}

/** An approval link rebuilds an expired preview for this long after it was first prepared. */
const APPROVAL_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const tooOld = (v: { createdAt?: number; expiresAt: number }) => Date.now() - (v.createdAt ?? v.expiresAt) > APPROVAL_LINK_MAX_AGE_MS;
const APPROVAL_TOO_OLD = "This approval link is more than a day old, so it can't be used any more. Ask the chat app to prepare it again.";

const APPROVAL_NOT_FOUND =
  "We couldn't find this in your Wura. Make sure you're signed in with the same email you connected to your chat app, or ask it to prepare this again.";

/**
 * Opens a preview from an approval link (/approve/<id>). Only the signed-in
 * owner's previews are visible: any other id gets the same not-found answer.
 * An expired, still-pending preview is rebuilt in place (same id) from the
 * stored address and amount, with every check run again, so the link from
 * the chat app keeps working but never approves stale numbers.
 */
export async function openApproval(
  s: Session,
  id: string,
): Promise<
  | { kind: "send"; intent: SendIntent }
  | { kind: "quote"; quote: Quote }
  | { kind: "site"; action: SiteAction }
  | { kind: "site-request"; request: SiteConnectRequest }
> {
  const w = wallet(s.userId);
  const siteAction = w.siteActions.get(id);
  if (siteAction) {
    if (siteAction.status === "pending" && Date.now() > siteAction.expiresAt) siteAction.status = "expired";
    // A site call can't be rebuilt here: the assistant has to read the site and simulate it again.
    if (siteAction.status === "expired") {
      // A real site call is simulated again by the approval route (refreshLiveAction); a mock one can't be rebuilt.
      if (!siteAction.live || tooOld(siteAction)) throw new ApiFailure("QUOTE_EXPIRED", "That preview expired. Ask your assistant again and I'll simulate it fresh.", 410);
    }
    return { kind: "site", action: siteAction };
  }
  const siteRequest = w.siteRequests.get(id);
  if (siteRequest) return { kind: "site-request", request: siteRequest };
  const intent = w.sends.get(id);
  if (intent?.cashOut) throw new ApiFailure("BAD_REQUEST", "Cash-outs are approved on the cash-out screen in Wura, not from a link.", 409);
  if (intent) {
    if (intent.status === "expired" || (intent.status === "pending" && Date.now() > intent.expiresAt)) {
      if (tooOld(intent)) throw new ApiFailure("QUOTE_EXPIRED", APPROVAL_TOO_OLD, 410);
      // A card in a chat app still shows the old numbers: it can't approve the rebuilt ones.
      delete (w.cardCodes ??= {})[intent.id];
      const contact = findContact(w, intent.to.address)!;
      Object.assign(intent, await sendFigures(s, w, contact, intent.asset, intent.amount, intent.memo));
    }
    return { kind: "send", intent };
  }
  const quote = w.quotes.get(id);
  if (quote) {
    if (quote.status === "expired" || (quote.status === "pending" && Date.now() > quote.expiresAt)) {
      if (tooOld(quote)) throw new ApiFailure("QUOTE_EXPIRED", APPROVAL_TOO_OLD, 410);
      await precheckSwap(s, quote.from, quote.amountIn);
      const fresh = await getQuote(s, { from: quote.from, to: quote.to, amountIn: quote.amountIn });
      w.quotes.delete(fresh.id);
      Object.assign(quote, { ...fresh, id: quote.id, createdAt: quote.createdAt });
    }
    return { kind: "quote", quote };
  }
  throw new ApiFailure("INTENT_NOT_FOUND", APPROVAL_NOT_FOUND, 404);
}

/** Previews still waiting for the user (for the per-user cap on chat apps). */
export function openPreviewCount(s: Session) {
  const w = wallet(s.userId);
  const now = Date.now();
  const open = (v: { status: string; expiresAt: number }) => v.status === "pending" && v.expiresAt > now;
  return [...w.sends.values()].filter(open).length + [...w.quotes.values()].filter(open).length + [...w.siteActions.values()].filter(open).length;
}

/** Step 2: send it. Re-checks everything; the preview is not trusted on its own. */
/**
 * `via: "chat"` is for chat channels (Telegram, WhatsApp, MCP) after the linked
 * user tapped Approve: on testnet it signs with the agent key (agent-key.ts)
 * instead of asking the browser wallet. Never reachable from the web routes.
 */
export async function createSend(s: Session, input: { intentId: string; approve: unknown; via?: "web" | "chat" }) {
  const w = wallet(s.userId);
  const intent = w.sends.get(String(input.intentId));
  if (!intent) throw new ApiFailure("INTENT_NOT_FOUND", "That payment preview doesn't exist. Ask again.", 404);
  // A cash-out payment is approved only on the cash-out screen, which reads the partner again (server/cashout.ts).
  if (intent.cashOut) throw new ApiFailure("BAD_REQUEST", "Approve this cash-out on the cash-out screen in Wura. Nothing was sent.", 409);
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
  if (moneyLive()) {
    if (input.via === "chat") {
      // Agent key when the user turned chat approvals on; the server's dev key
      // (TESTNET_SIGNER=server-dev) also works without a browser.
      if (chatApprovalsAvailable() && (await chatApprovalStatus(s)).active) return sendWithAgentKey(s, intent);
      if (serverDevSigning()) return startTestnetSend(s, intent);
      throw new ApiFailure(
        "CHAT_APPROVAL_OFF",
        "Chat approvals are off for your wallet. Turn them on in Wura on the web (Channels), then try again.",
        403,
      );
    }
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
  delete (wallet(s.userId).cardCodes ??= {})[intentId];
  const i = wallet(s.userId).sends.get(intentId);
  if (i && i.status === "pending") i.status = "cancelled";
  return { ok: true };
}

// ---------- Payment links ----------

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 8 random characters (40 bits, so a code can't be guessed) and the amount, e.g. "K7P2QX4M-15K". Also the link's payment memo (13 characters, under the 28 allowed). */
function linkCode(amount: number, currency: Currency) {
  const b = randomBytes(8);
  const head = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  const whole = Math.round(amount / 100);
  const tail =
    currency === "NGN" && whole >= 1000 && whole % 1000 === 0 ? `${whole / 1000}K` : String(whole).slice(0, 4);
  return `${head}-${tail}`;
}

export async function createPaymentLink(s: Session, input: { amount: number; currency?: Currency }): Promise<PaymentLink> {
  const w = wallet(s.userId);
  assertInvited(s.email);
  const amount = requirePositiveInt(input.amount, "amount");
  const currency: Currency = input.currency === "USDC" ? "USDC" : "NGN";
  if (moneyLive()) {
    // The money goes straight to the creator's wallet, so it has to be able to receive this asset.
    if (!assetFor(currency)) {
      throw new ApiFailure("BAD_REQUEST", `${currency === "NGN" ? "Naira (NGNC)" : currency} links aren't available on ${config.networkLabel}.`, 409);
    }
    const acct = await getAccountStatus(s.address);
    const ready = acct.exists && (currency === "USDC" ? acct.hasTrustline : acct.hasNgncTrustline);
    if (!ready) {
      throw new ApiFailure("BAD_REQUEST", `Your wallet can't receive ${currency === "NGN" ? "naira (NGNC)" : currency} yet. Finish wallet setup first, then make the link.`, 409);
    }
  }
  const base = config.appUrl || (onMainnet() ? "" : "http://localhost:3000");
  if (!base) throw new ApiFailure("BAD_REQUEST", "Payment links need APP_URL to be set, so there's no address to give the payer.", 503);
  const code = linkCode(amount, currency);
  const now = Date.now();
  const link: PaymentLink = {
    id: newId("lnk"),
    code,
    url: `${base}/pay/${code}`,
    address: s.address,
    memo: code,
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
