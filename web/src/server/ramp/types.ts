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
 *   - All amounts are minor units (kobo), integers.
 */

export type RampId = "mock" | "link";

export type RampBounds = {
  enabled: boolean;
  /** Minor units. null when there is no bound. */
  min: number | null;
  max: number | null;
};

export type RampLimits = { topUp: RampBounds; cashOut: RampBounds };

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
  /** Partner limits with Wura's own trial cap already applied. */
  limits: RampLimits;
};

/** A top-up the user completes by bank transfer (mock). */
export type TopUpOrder = {
  id: string;
  amount: number;
  status: "awaiting_transfer";
  mock: true;
  /** Fictional transfer details. Do not pay these. */
  transfer: { bank: string; accountNumber: string; accountName: string; reference: string };
  expiresAt: number;
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
  /** The partner's own limits, before Wura's trial cap. */
  limits(): Promise<RampLimits>;
  /** Only for providers whose identityCheck is "wura_mock". */
  verifyIdentity(s: Session, input: { nin: unknown; consent: unknown }): { kycStatus: "verified" };
  /** The amount has already been checked against the limits. */
  startTopUp(s: Session, input: { amount: number }): Promise<TopUpOrder>;
  /** Never signs. See the boundaries above. */
  previewCashOut(s: Session, input: { amount: number }): Promise<CashOutPreview>;
  /**
   * A naira ↔ USDC price from the partner, for routing to compare as one more
   * venue. null when the partner gives no quotes.
   */
  quote(input: { from: "NGN" | "USDC"; to: "NGN" | "USDC"; amountIn: number }): Promise<{ amountOut: number } | null>;
}
