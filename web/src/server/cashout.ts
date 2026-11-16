import "server-only";
import type { Currency, PaymentMemo, SendIntent } from "@/lib/types";
import { money } from "@/lib/format";
import { config, onMainnet } from "./config";
import { ApiFailure } from "./errors";
import { checkLimits, limitsFor } from "./money";
import { cashOutPayment, ramp } from "./ramp";
import { claimCashOutPayment, findTransfer, releaseCashOutPayment, type TransferRow } from "./ramp/records";
import type { CashOutPayment, PartnerSignIn, RampCurrency } from "./ramp/types";
import type { Session } from "./session";
import { assetFor, getAccountStatus, type AccountStatus, type BuiltTx } from "./stellar";
import { newId, wallet, type WalletState } from "./store";
import { assetBalance, buildIntentPayment, destinationProblem, needsSignature, park } from "./testnet";
import { assertInvited } from "./treasury";

/**
 * The payment that finishes a cash-out to a bank account (M6).
 *
 * The user starts a cash-out on the partner's page (server/ramp). When the
 * partner is ready it says where to pay, which memo to use and how much. That
 * answer comes from outside, so it is never trusted on its own:
 *
 *   - it is read fresh from the partner when the preview is made, again when
 *     the user approves, and again just before the signed payment is
 *     submitted; if anything differs from what the user approved, nothing is
 *     sent;
 *   - the asset must be the one Wura pins for this currency on mainnet;
 *   - the amount can't be more than the user started the cash-out with
 *     (ramp_transfers.amount), and the caps and the balance apply to it;
 *   - each cash-out is paid at most once: before submit, the payment's hash
 *     is claimed on the cash-out's ramp_transfers row (saved at once, so it
 *     survives a timeout mid-submit) and in WalletState.cashOutPaid; it is
 *     given back only when the network rejects the payment for certain.
 *
 * The payment itself is an ordinary send intent (tagged `cashOut`), signed by
 * the user's own wallet and logged like a send. Chat apps and approval links
 * can't approve it: they would skip the fresh partner read.
 */

const NAME = "The partner";

/** Where the cash-out's payment details come from. Swapped in tests. */
export type CashOutDeps = {
  payment: (s: Session, input: { id: string; from: RampCurrency; partnerToken?: string }) => Promise<CashOutPayment | PartnerSignIn | null>;
  transfer: (key: { provider: string; service: RampCurrency; anchorTxId: string }) => Promise<TransferRow | null>;
  balance: (s: Session, asset: Currency) => Promise<number>;
  account: (address: string) => Promise<AccountStatus>;
  build: (s: Session, intent: SendIntent) => Promise<BuiltTx>;
  /** Claims the cash-out for one payment; true when this payment owns it (or already did). */
  claim: (key: TransferKey, txHash: string) => Promise<boolean>;
  release: (key: TransferKey, txHash: string) => Promise<void>;
};

type TransferKey = { provider: string; service: RampCurrency; anchorTxId: string };
const keyFor = (c: NonNullable<SendIntent["cashOut"]>): TransferKey => ({ provider: ramp().id, service: c.from, anchorTxId: c.id });

const live: CashOutDeps = {
  payment: cashOutPayment,
  transfer: findTransfer,
  balance: assetBalance,
  account: getAccountStatus,
  build: buildIntentPayment,
  claim: claimCashOutPayment,
  release: releaseCashOutPayment,
};

/** The browser's partner sign-in for a currency (a cookie), when there is one. */
export type TokenFor = (from: RampCurrency) => Promise<string | undefined>;

const refuse = (code: ConstructorParameters<typeof ApiFailure>[0], msg: string, status = 409) => new ApiFailure(code, msg, status);

/**
 * The partner sign-in lapsed (or is about to). Carries the partner's new
 * sign-in challenge, so the screen can ask the wallet to sign it and then
 * repeat the same step. Nothing was claimed, cancelled or sent.
 */
export class PartnerSignInNeeded extends ApiFailure {
  constructor(public signIn: PartnerSignIn) {
    super("PARTNER_SIGNIN", "Your sign-in with the partner has expired. Sign in again with your wallet, then carry on. Nothing was sent.", 409);
  }
}

/** For the cash-out routes: a sign-in the partner needs is an answer for the screen, not an error. */
export async function orPartnerSignIn<T>(step: () => Promise<T>): Promise<T | PartnerSignIn> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof PartnerSignInNeeded) return e.signIn;
    throw e;
  }
}

const isSignIn = (v: unknown): v is PartnerSignIn => typeof v === "object" && v !== null && (v as PartnerSignIn).status === "needs_partner_signin";

/**
 * The partner's memo as a payment memo. SEP-24 sends a hash memo as base64;
 * it must decode to exactly 32 bytes. Anything else is refused, never guessed.
 */
export function partnerMemo(type: CashOutPayment["memoType"], value: string): PaymentMemo {
  const bad = () => refuse("BAD_REQUEST", "The partner sent a payment reference we can't use, so nothing was sent. Contact support with this cash-out's reference.", 502);
  if (type === "text") {
    if (!value || Buffer.byteLength(value, "utf8") > 28) throw bad();
    return { type, value };
  }
  if (type === "id") {
    if (!/^\d{1,20}$/.test(value) || BigInt(value) > BigInt("18446744073709551615")) throw bad();
    return { type, value };
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return { type, value: value.toLowerCase() };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw bad();
  const raw = Buffer.from(value, "base64");
  if (raw.length !== 32) throw bad();
  return { type, value: raw.toString("hex") };
}

/**
 * What's wrong with the partner's account for this payment, if anything. The
 * partner may take payment at its token's issuer, which holds no trustline to
 * its own token; there, only that the account exists is checked.
 */
export function cashOutDestinationProblem(st: AccountStatus, asset: Currency, memo: PaymentMemo) {
  if (st.address === assetFor(asset)?.getIssuer()) {
    return st.exists ? null : refuse("UNKNOWN_CONTACT", "The partner's account doesn't exist, so nothing was sent.", 502);
  }
  return destinationProblem(st, NAME, asset, memo);
}

/** True when the partner's answer is exactly the payment the user approved. */
export function samePayment(intent: SendIntent, p: CashOutPayment, memo: PaymentMemo) {
  return (
    intent.to.address === p.destination &&
    intent.amount === p.amount &&
    intent.asset === p.currency &&
    intent.memo?.type === memo.type &&
    intent.memo?.value === memo.value &&
    (intent.cashOut?.fee ?? null) === (p.fee ?? null) &&
    JSON.stringify(intent.cashOut?.receive ?? null) === JSON.stringify(p.receive ?? null)
  );
}

/** Reads the partner's payment details for this cash-out and checks them against what Wura knows. */
async function readPayment(s: Session, id: string, from: RampCurrency, partnerToken: string | undefined, deps: CashOutDeps, exceptHash?: string) {
  if (!onMainnet() || !ramp().live) {
    throw refuse("BAD_REQUEST", "Cash-outs to a bank account need the live partner on mainnet.");
  }
  const p = await deps.payment(s, { id, from, partnerToken });
  if (isSignIn(p)) throw new PartnerSignInNeeded(p);
  if (!p) {
    throw refuse("NOT_READY", "The partner isn't ready for your payment yet. Finish the steps on the partner's page, then check again. Nothing was sent.");
  }
  const pinned = assetFor(from);
  const wrong = () => refuse("BAD_REQUEST", "The partner asked for a payment that doesn't match this cash-out, so nothing was sent. Contact support with this cash-out's reference.", 502);
  if (p.id !== id || p.currency !== from || p.network !== "mainnet") throw wrong();
  if (!pinned || pinned.getCode() !== p.asset.code || pinned.getIssuer() !== p.asset.issuer) throw wrong();
  if (p.destination === s.address) throw wrong();
  // The fee and what reaches the bank are shown to the user, so they must add up.
  const fee = p.fee ?? null;
  const receive = p.receive ?? null;
  if (fee !== null && (!Number.isInteger(fee) || fee < 0 || fee >= p.amount)) throw wrong();
  if (receive !== null && (!Number.isInteger(receive.amount) || receive.amount <= 0)) throw wrong();
  if (receive !== null && receive.currency === from && receive.amount !== p.amount - (fee ?? 0)) {
    // Numbers only (no memo, no token), so the Stage 3 check can see why LINK's answer was refused.
    console.error("[cashout] amounts don't add up", { id, amount: p.amount, fee, receive: receive.amount });
    throw wrong();
  }
  // Every cash-out is recorded before the user is sent to the partner's page (ramp/link.ts).
  const row = await deps.transfer({ provider: ramp().id, service: from, anchorTxId: id });
  if (!row || row.userId !== s.userId || row.address !== s.address || row.kind !== "cashout") {
    throw refuse("INTENT_NOT_FOUND", "We have no record of starting this cash-out from your wallet, so nothing was sent.", 404);
  }
  // A payment already claimed it (or the partner saw one arrive): only that same payment may go on.
  if (row.stellarTxId && row.stellarTxId !== exceptHash) throw paidOnce();
  if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount > row.amount) {
    throw refuse(
      "BAD_REQUEST",
      `The partner asked for ${money(p.amount, from)}, more than the ${money(row.amount, from)} you started this cash-out with, so nothing was sent.`,
      409,
    );
  }
  return { p, memo: partnerMemo(p.memoType, p.memo) };
}

/** Caps, balance and the partner's account, checked against the live numbers. */
async function recheck(s: Session, w: WalletState, p: CashOutPayment, memo: PaymentMemo, deps: CashOutDeps) {
  assertInvited(s.email);
  checkLimits(w, p.currency, p.amount);
  const bal = await deps.balance(s, p.currency);
  if (p.amount > bal) {
    throw refuse("INSUFFICIENT_BALANCE", `You don't have enough to pay this cash-out. Your balance is ${money(bal, p.currency)}.`, 403);
  }
  const problem = cashOutDestinationProblem(await deps.account(p.destination), p.currency, memo);
  if (problem) throw problem;
  return bal;
}

const paidOnce = () => refuse("ALREADY_USED", "This cash-out has already been paid from your wallet. Nothing more was sent.");

function alreadyPaid(w: WalletState, id: string, exceptHash?: string) {
  const paid = w.cashOutPaid?.[id];
  if (paid && paid !== exceptHash) throw paidOnce();
}

/** Step 1: the payment preview, once the partner says it is ready. Nothing is signed here. */
export async function prepareCashOutPayment(
  s: Session,
  input: { id: string; from: RampCurrency },
  tokenFor: TokenFor,
  deps: CashOutDeps = live,
): Promise<SendIntent> {
  const w = wallet(s.userId);
  alreadyPaid(w, input.id);
  const { p, memo } = await readPayment(s, input.id, input.from, await tokenFor(input.from), deps);
  const balanceBefore = await recheck(s, w, p, memo, deps);
  // One open preview per cash-out: an older one can no longer be approved.
  for (const old of w.sends.values()) {
    if (old.cashOut?.id === input.id && old.status === "pending") old.status = "cancelled";
  }
  const limits = limitsFor(w);
  const intent: SendIntent = {
    id: newId("snd"),
    createdAt: Date.now(),
    to: { name: NAME, address: p.destination, saved: false },
    asset: p.currency,
    memo,
    amount: p.amount,
    fee: 0,
    total: p.amount,
    balanceBefore,
    dailyRemainingAfter: limits.remainingToday[p.currency] - p.amount,
    dailyLimit: limits.daily[p.currency],
    perPaymentCap: limits.perPayment[p.currency],
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
    cashOut: { id: input.id, from: input.from, fee: p.fee ?? null, receive: p.receive ?? null },
  };
  w.sends.set(intent.id, intent);
  return intent;
}

/** Step 2: the user approved. Reads the partner again, re-checks everything, and builds the payment for the wallet to sign. */
export async function approveCashOutPayment(
  s: Session,
  input: { intentId: string; approve: unknown },
  tokenFor: TokenFor,
  deps: CashOutDeps = live,
) {
  const w = wallet(s.userId);
  const intent = w.sends.get(String(input.intentId));
  if (!intent?.cashOut) throw refuse("INTENT_NOT_FOUND", "That cash-out payment doesn't exist. Check the cash-out again.", 404);
  if (intent.status !== "pending") throw refuse("ALREADY_USED", "That cash-out payment was already sent or cancelled.");
  if (Date.now() > intent.expiresAt) {
    intent.status = "expired";
    throw refuse("QUOTE_EXPIRED", "That preview expired. Check the cash-out again and I'll prepare a fresh one.", 410);
  }
  if (input.approve !== true) throw refuse("NOT_APPROVED", "Nothing was sent. A cash-out only goes ahead when you approve it.", 403);
  const { id, from } = intent.cashOut;
  alreadyPaid(w, id);
  const { p, memo } = await readPayment(s, id, from, await tokenFor(from), deps);
  if (!samePayment(intent, p, memo)) {
    intent.status = "cancelled";
    throw refuse("CHANGED", "The partner changed the payment details since you looked, so nothing was sent. Check the cash-out again.");
  }
  await recheck(s, w, p, memo, deps);
  const tx = await deps.build(s, intent);
  return { ...needsSignature(s, park(w, tx, "send", intent.id)), intent };
}

/**
 * Step 3, for submitSigned (server/testnet.ts). `check` runs under the wallet
 * lock after the signature is checked and before the payment is submitted:
 * it reads the partner one last time and claims the cash-out for this
 * transaction. `release` gives the claim back after a definite rejection.
 */
export function cashOutSubmitCheck(s: Session, tokenFor: TokenFor, deps: CashOutDeps = live) {
  const check = async (w: WalletState, intent: SendIntent, txHash: string) => {
    // A preview that was replaced, cancelled or refused can't be paid, even with a signature for it.
    if (intent.status !== "pending") throw refuse("ALREADY_USED", "That cash-out payment was replaced or cancelled, so nothing was sent. Check the cash-out again.");
    const { id, from } = intent.cashOut!;
    alreadyPaid(w, id, txHash);
    const { p, memo } = await readPayment(s, id, from, await tokenFor(from), deps, txHash);
    if (!samePayment(intent, p, memo)) {
      intent.status = "cancelled";
      throw refuse("CHANGED", "The partner changed the payment details since you approved, so nothing was sent. Check the cash-out again.");
    }
    await recheck(s, w, p, memo, deps);
    // Saved on its own connection the moment it returns, so a timeout mid-submit can't lose it.
    if (!(await deps.claim(keyFor(intent.cashOut!), txHash))) throw paidOnce();
    (w.cashOutPaid ??= {})[id] = txHash;
  };
  const release = async (w: WalletState, intent: SendIntent, txHash: string) => {
    const { id } = intent.cashOut!;
    if (w.cashOutPaid?.[id] === txHash) delete w.cashOutPaid[id];
    await deps.release(keyFor(intent.cashOut!), txHash);
  };
  return { check, release };
}

export type CashOutCheck = ReturnType<typeof cashOutSubmitCheck>;
