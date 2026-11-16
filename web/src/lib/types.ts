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
  /** How the venue routes it, e.g. "via XLM" or "1 pool". Live quotes only. */
  route?: string;
};

export type UnquotedVenue = { venue: VenueId; name: string; reason: string };

export type Quote = {
  id: string;
  /** When it was first prepared; an approval link stops rebuilding it after a day. */
  createdAt?: number;
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
  /** "live": real venue prices (Stellar mainnet, read-only). "example": fixed demo prices. */
  source: "live" | "example";
  /** Reference market rate, NGN per USD, when available. */
  market?: { rate: number; source: string; updatedAt: string };
  /** How much worse (negative) or better the best quote is than the market rate, in percent. */
  vsMarketPct?: number;
};

/** A saved recipient ("favourite"). */
export type Contact = { name: string; address: string };

export type SendIntent = {
  id: string;
  /** When it was first prepared; an approval link stops rebuilding it after a day. */
  createdAt?: number;
  /** `saved` is false when the user typed a raw address that isn't in their favourites. */
  to: { name: string; address: string; saved?: boolean };
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

export type ActivityKind = "swap" | "send" | "link" | "fund" | "site";
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
  /** Block explorer link for real (testnet) transactions. */
  explorerUrl?: string;
};

export type KycStatus = "none" | "verified";

export type Me = {
  email: string;
  address: string;
  authMode: "privy" | "mock";
  moneyMode: "mock" | "testnet" | "mainnet";
  /** Who signs real testnet transactions. */
  signer: "mock" | "privy" | "server-dev";
  kycStatus: KycStatus;
};

/** Testnet wallet readiness (MONEY_MODE=testnet). */
export type WalletStatus = {
  address: string;
  network: "testnet" | "mainnet";
  exists: boolean;
  xlm: string;
  usdc: number | null;
  hasTrustline: boolean;
  ready: boolean;
  usdcIssuer: string;
  usingCircleUsdc: boolean;
};

/** A built transaction waiting for the user's wallet to sign its hash. */
export type NeedsSignature = { status: "needs_signature"; txId: string; hash: string; address: string };

/** Whether chat apps can approve sends from this wallet (testnet agent key). */
export type ChatApprovalStatus = {
  /** False when the server isn't set up for it (not testnet, or no AGENT_KEY_SECRET). */
  available: boolean;
  /** The agent key is a signer on the user's Stellar account right now (read from Horizon). */
  active: boolean;
  agentAddress?: string;
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
  | "SIGNING_UNAVAILABLE" | "MONEY_PAUSED"
  | "SITE_NOT_ALLOWED"
  | "SITE_UNSUPPORTED"
  | "CONTRACT_NOT_FOUND"
  | "CONTRACT_UNVERIFIED"
  | "SIMULATION_FAILED"
  | "CHAT_APPROVAL_OFF";

export type ApiError = { error: { code: ApiErrorCode; message: string } };

// ---------- Site connect (docs/site-connect.md) ----------

/** A site the user has allowed Wura to connect to. Not permission to sign. */
export type AllowedSite = { host: string; name: string; addedAt: number };

/** A "Connect to this site?" question waiting for the user's answer. */
export type SiteConnectRequest = {
  id: string;
  host: string;
  url: string;
  /** What the user asked for, e.g. "buy a concert ticket". */
  want: string;
  createdAt: number;
  status: "pending" | "connected" | "declined";
};

/** What contract discovery found, step by step (mocked in v1). */
export type DiscoveryStep = { label: string; detail: string };

export type SiteAction = {
  id: string;
  host: string;
  siteName: string;
  want: string;
  contract: { address: string; verified: boolean; name: string };
  /** The contract function Wura will call, read from the on-chain spec. */
  call: { fn: string; args: Array<{ name: string; type: string; value: string }> };
  steps: DiscoveryStep[];
  /** Plain-language summary of what signing does. */
  summary: string;
  asset: Currency;
  price: number;
  fee: number;
  total: number;
  balanceBefore: number;
  dailyRemainingAfter: number;
  dailyLimit: number;
  perPaymentCap: number;
  expiresAt: number;
  status: "pending" | "signed" | "cancelled" | "expired";
};

/** A card the chat can show under an agent message. */
export type AgentCard =
  | { type: "quote"; quote: Quote }
  | { type: "send"; intent: SendIntent }
  | { type: "link"; link: PaymentLink }
  | { type: "balance"; balances: Balances; limits: Limits }
  | { type: "rates"; quote: Quote }
  | { type: "refused"; code: ApiErrorCode; title: string; lines: string[] }
  | { type: "site-permission"; request: SiteConnectRequest; siteName: string }
  | { type: "site-action"; action: SiteAction }
  | { type: "save-contact"; address: string };

export type AgentReply = { text: string; card?: AgentCard };
