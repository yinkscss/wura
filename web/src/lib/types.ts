// Types shared by the API layer (src/server) and the UI.
// Amounts are integers in minor units: kobo for NGN, cents for USDC.
// (USDC on Stellar has 7 decimals; the preview works in cents.)

export type Currency = "NGN" | "USDC";

export type VenueId = "sdex" | "soroswap" | "aquarius";

export const VENUE_NAMES: Record<VenueId, string> = {
  sdex: "SDEX",
  soroswap: "Soroswap",
  aquarius: "Aquarius",
};

export type VenueQuote = {
  venue: VenueId;
  name: string;
  /** What the user receives from this venue, in minor units of `to`. */
  amountOut: number;
  /** NGN per 1 USDC, all-in. */
  rate: number;
  best: boolean;
};

export type UnquotedVenue = { venue: VenueId; name: string; reason: string };

export type Quote = {
  id: string;
  from: Currency;
  to: Currency;
  amountIn: number;
  /** Best amount out, in minor units of `to`. */
  amountOut: number;
  /** NGN per 1 USDC for the best venue. */
  rate: number;
  /** Fee already included in the rate, in minor units of `from`. */
  fee: number;
  venues: VenueQuote[];
  unquoted: UnquotedVenue[];
  bestVenue: VenueId;
  expiresAt: number;
  status: "pending" | "approved" | "cancelled" | "expired";
};

export type SendIntent = {
  id: string;
  to: { name: string; address: string };
  asset: Currency;
  amount: number;
  fee: number;
  total: number;
  balanceBefore: number;
  dailyRemainingAfter: number;
  dailyLimit: number;
  perPaymentCap: number;
  expiresAt: number;
  status: "pending" | "sent" | "cancelled" | "expired";
};

export type PaymentLink = {
  id: string;
  code: string;
  url: string;
  amount: number;
  currency: Currency;
  status: "open" | "paid" | "expired";
  createdAt: number;
  expiresAt: number;
};

export type Balances = Record<Currency, number>;

export type Limits = {
  /** Example values. Real cap amounts are still an open question. */
  example: true;
  daily: Balances;
  perPayment: Balances;
  spentToday: Balances;
  remainingToday: Balances;
};

export type ActivityKind = "swap" | "send" | "link" | "fund";
export type ActivityStatus = "done" | "open" | "pending" | "refused";

export type Activity = {
  id: string;
  at: number;
  kind: ActivityKind;
  detail: string;
  /** Display amount, e.g. "31.20 USDC" or "₦15,000". */
  amount: string;
  status: ActivityStatus;
  /** Mock or real transaction reference, when one exists. */
  txRef?: string;
};

export type KycStatus = "none" | "verified";

export type Me = {
  email: string;
  address: string;
  authMode: "privy" | "mock";
  moneyMode: "mock" | "testnet";
  kycStatus: KycStatus;
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_APPROVED"
  | "QUOTE_EXPIRED"
  | "QUOTE_NOT_FOUND"
  | "INTENT_NOT_FOUND"
  | "ALREADY_USED"
  | "LIMIT_PER_PAYMENT"
  | "LIMIT_DAILY"
  | "INSUFFICIENT_BALANCE"
  | "UNKNOWN_CONTACT"
  | "NO_VENUES"
  | "KYC_REQUIRED"
  | "TRIAL_LIMIT"
  | "BAD_REQUEST"
  | "SIGNING_UNAVAILABLE";

export type ApiError = { error: { code: ApiErrorCode; message: string } };

/** A card the chat can show under an agent message. */
export type AgentCard =
  | { type: "quote"; quote: Quote }
  | { type: "send"; intent: SendIntent }
  | { type: "link"; link: PaymentLink }
  | { type: "balance"; balances: Balances; limits: Limits }
  | { type: "rates"; quote: Quote }
  | { type: "refused"; code: ApiErrorCode; title: string; lines: string[] };

export type AgentReply = { text: string; card?: AgentCard };
