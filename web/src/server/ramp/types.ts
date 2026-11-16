import type { Session } from "../session";

/**
 * The naira partner interface ("ramp"): money in from a bank account, money
 * out to a bank account, and the identity check the partner requires.
 *
 * Agreed boundaries (docs/money-side.md):
 *   - Nothing in this folder signs or submits a Stellar transaction. A cash-out
 *     returns a preview; the payment itself goes through the same approval,
 *     limit checks, signing and log as a send (server/money.ts).
 *   - Identity numbers (NIN, BVN) are never stored or logged. Where the partner
 *     has its own hosted page for the check, that page is used.
 *   - All amounts are minor units (kobo or cents), integers.
 */

export type RampId = "mock" | "link";

export type RampBounds = {
  enabled: boolean;
  /** Minor units. null when there is no bound. */
  min: number | null;
  max: number | null;
};

/**
 * What a top-up lands as in the wallet. The user always pays naira from a bank
 * account. "NGN": it stays naira. "USDC": it arrives as dollars. Limits and
 * top-up amounts are in this currency.
 */
export type RampCurrency = "NGN" | "USDC";

export type RampLimits = { currency: RampCurrency; topUp: RampBounds; cashOut: RampBounds };

export type RampInfo = {
  provider: RampId;
  /** False for the mock: nothing real happens. */
  live: boolean;
  /**
   * Where the identity check happens. "wura_mock": Wura's example form (mock
   * only). "partner_page": on the partner's own hosted page; Wura never sees
   * the details.
   */
  identityCheck: "wura_mock" | "partner_page";
  /** Limits for the default choice (the first of `options`), with Wura's own trial cap applied. */
  limits: RampLimits;
  /** One entry per thing a top-up can land as. The mock has naira only. */
  options: RampLimits[];
};

/** A top-up the user completes by bank transfer (mock). */
export type MockTopUp = {
  id: string;
  amount: number;
  status: "awaiting_transfer";
  mock: true;
  /** Fictional transfer details. Do not pay these. */
  transfer: { bank: string; accountNumber: string; accountName: string; reference: string };
  expiresAt: number;
};

/**
 * A top-up the user finishes on the partner's own page. Nothing has moved yet.
 * The page collects identity and bank details; Wura never sees them.
 */
export type PartnerTopUp = {
  id: string;
  amount: number;
  currency: RampCurrency;
  status: "open_partner_page";
  mock: false;
  /** HTTPS, on the partner's own domain. Open it for the user; never fetch it from the server. */
  url: string;
};

export type TopUpOrder = MockTopUp | PartnerTopUp;

/**
 * The partner wants proof that the user owns this wallet before it starts a
 * top-up. `hash` is a sign-in challenge that was checked first: it can't move
 * money (docs/money-side.md). The wallet signs it, and the screen posts
 * `challenge` and the signature to /api/funding/naira/signin.
 */
export type PartnerSignIn = {
  status: "needs_partner_signin";
  /** Send this back with the signature: each choice has its own partner sign-in. */
  receive: RampCurrency;
  hash: string;
  address: string;
  challenge: string;
  /** Unix ms. */
  expiresAt: number;
};

/** A partner session for one wallet. Only ever sent back to the partner. */
export type PartnerSession = { token: string; /** Unix ms. */ expiresAt: number };

/** Where a top-up has got to, in Wura's plain states. */
export type TopUpStatus = {
  id: string;
  state: "waiting_for_you" | "processing" | "done" | "failed";
  /** What to tell the user, in words they can act on. */
  message: string;
  currency: RampCurrency;
  /** What arrived in the wallet, once the partner says. */
  received: number | null;
  fee: number | null;
  /** Stellar transaction hash once the partner has paid. */
  txRef: string | null;
};

/**
 * A cash-out the user continues on the partner's own page, where they enter
 * the bank account. Nothing has moved yet.
 */
export type PartnerCashOut = Omit<PartnerTopUp, "currency"> & {
  /** What leaves the wallet: naira ("NGN") or dollars ("USDC"). The bank account always receives naira. */
  currency: RampCurrency;
};

/** Where a cash-out has got to. */
export type CashOutStatus = {
  id: string;
  state: "waiting_for_you" | "processing" | "done" | "failed";
  /** What to tell the user, in words they can act on. */
  message: string;
  currency: RampCurrency;
  /** What the wallet has to send, once the partner says. Minor units of `currency`. */
  send: number | null;
  fee: number | null;
  /**
   * True once the partner is waiting for the wallet's payment. The payment is
   * a money move: it needs the user's approval and goes through the limit
   * checks and the log like a send. The screen can't make it from here.
   */
  readyToPay: boolean;
  /** Stellar transaction hash once the partner has seen the payment. */
  txRef: string | null;
};

/**
 * Exactly what the wallet must send to finish a cash-out. Server-side only,
 * for the money code (server/money.ts) to show, get approved, limit-check,
 * build and sign. Nothing in this folder signs it.
 */
export type CashOutPayment = {
  id: string;
  network: "mainnet";
  currency: RampCurrency;
  asset: { code: string; issuer: string };
  /** Minor units of `currency`. */
  amount: number;
  destination: string;
  memo: string;
  memoType: "text" | "id" | "hash";
  /** The partner's fee (SEP-24 amount_fee), minor units of `currency`, when it says. Shown to the user. */
  fee?: number | null;
  /** What reaches the bank (SEP-24 amount_out), when the partner says. Naira for both services. */
  receive?: { amount: number; currency: RampCurrency } | null;
};

/** What a cash-out would do. Shown to the user before anything is approved or signed. */
export type CashOutPreview = {
  id: string;
  amount: number;
  fee: number;
  /** What reaches the bank account: amount minus fee. */
  receive: number;
  expiresAt: number;
  mock: boolean;
};

export interface RampProvider {
  id: RampId;
  live: boolean;
  identityCheck: RampInfo["identityCheck"];
  /** What a top-up can land as. The first is the default. */
  receives: RampCurrency[];
  /** The partner's own limits, before Wura's trial cap. */
  limits(receive: RampCurrency): Promise<RampLimits>;
  /** Only for providers whose identityCheck is "wura_mock". */
  verifyIdentity(s: Session, input: { nin: unknown; consent: unknown }): { kycStatus: "verified" };
  /**
   * The amount has already been checked against the limits. Providers with a
   * partner sign-in return PartnerSignIn when `partnerToken` is missing or stale.
   */
  startTopUp(s: Session, input: { amount: number; receive: RampCurrency; partnerToken?: string }): Promise<TopUpOrder | PartnerSignIn>;
  /** Only for providers with a partner sign-in. Checks the challenge again, then trades it for a session. */
  finishSignIn?(s: Session, input: { receive: RampCurrency; challenge: unknown; signature: unknown }): Promise<PartnerSession>;
  /** Only for live providers. */
  topUpStatus?(s: Session, input: { id: string; receive: RampCurrency; partnerToken?: string }): Promise<TopUpStatus | PartnerSignIn>;
  /**
   * Only for live providers. Opens the partner's page for a cash-out. `amount`
   * has already been checked against the limits. Never signs.
   */
  startCashOut?(s: Session, input: { amount: number; from: RampCurrency; partnerToken?: string }): Promise<PartnerCashOut | PartnerSignIn>;
  cashOutStatus?(s: Session, input: { id: string; from: RampCurrency; partnerToken?: string }): Promise<CashOutStatus | PartnerSignIn>;
  /** For the money code only. null until the partner is ready to be paid. Never signs. */
  /**
   * The exact payment that finishes a cash-out, or null while the partner
   * isn't ready. PartnerSignIn when the partner sign-in is missing, rejected,
   * or has less than the smaller of 10 minutes and half its lifetime left (so it
   * can't lapse between approve and submit, and a short sign-in can't loop).
   */
  cashOutPayment?(s: Session, input: { id: string; from: RampCurrency; partnerToken?: string }): Promise<CashOutPayment | PartnerSignIn | null>;
  /** Mock only. Never signs. See the boundaries above. */
  previewCashOut(s: Session, input: { amount: number }): Promise<CashOutPreview>;
  /**
   * A naira ↔ USDC price from the partner, for routing to compare as one more
   * venue. null when the partner gives no quotes.
   */
  quote(input: { from: "NGN" | "USDC"; to: "NGN" | "USDC"; amountIn: number }): Promise<{ amountOut: number } | null>;
}
