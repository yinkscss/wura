import "server-only";
import { randomBytes } from "node:crypto";
import { naira } from "@/lib/format";
import { ApiFailure } from "./errors";
import type { Session } from "./session";
import { newId, wallet } from "./store";

/**
 * Naira on-ramp through Paycrest — mocked in v1.
 *
 * Rules from docs/kyc-and-funding.md:
 *   - KYC is never bypassed. A naira order needs a passed identity check.
 *   - We store only that the check passed (a verified status), never the NIN.
 *   - Paycrest currently asks for a NIN on each order. Whether a past check can
 *     be reused is NOT confirmed, so the UI must not promise a one-time NIN.
 *   - Small trial limits while this is new.
 *
 * Open (see docs/open-questions.md and the routing notes): Paycrest's settlement
 * networks do not currently list Stellar, so the live flow needs a bridge leg
 * or a Stellar anchor. That decision is still open.
 *
 * Live version: call Paycrest's Sender API with our own API key (server-side
 * only, PAYCREST_API_KEY) and return the bank transfer details it gives us.
 */

/** Example trial cap per naira top-up. Real amount not decided yet. */
export const EXAMPLE_TRIAL_TOPUP_CAP = 50_000_00;

export type OnrampOrder = {
  id: string;
  amount: number;
  status: "awaiting_transfer";
  mock: true;
  /** Fictional transfer details. Do not pay these. */
  transfer: { bank: string; accountNumber: string; accountName: string; reference: string };
  expiresAt: number;
};

/** Mock identity check. Validates the format only, then forgets the number. */
export function verifyIdentity(s: Session, input: { nin: unknown; consent: unknown }) {
  const nin = String(input.nin ?? "").replace(/\s+/g, "");
  if (input.consent !== true) {
    throw new ApiFailure("BAD_REQUEST", "Please agree to the identity check to continue.");
  }
  if (!/^\d{11}$/.test(nin)) {
    throw new ApiFailure("BAD_REQUEST", "A NIN is 11 digits. Check the number and try again.");
  }
  // Live: forward to the on-ramp's identity check. We keep only the result.
  const w = wallet(s.userId);
  w.kycStatus = "verified";
  return { kycStatus: w.kycStatus };
}

export function createOnrampOrder(s: Session, input: { amount: number }): OnrampOrder {
  const w = wallet(s.userId);
  if (w.kycStatus !== "verified") {
    throw new ApiFailure(
      "KYC_REQUIRED",
      "Naira top-ups need an identity check first. USDC needs no ID.",
      403,
    );
  }
  const amount = input.amount;
  if (!Number.isInteger(amount) || amount < 1_000_00) {
    throw new ApiFailure("BAD_REQUEST", "The smallest naira top-up is ₦1,000.");
  }
  if (amount > EXAMPLE_TRIAL_TOPUP_CAP) {
    throw new ApiFailure(
      "TRIAL_LIMIT",
      `While naira top-ups are new, each one is capped at ${naira(EXAMPLE_TRIAL_TOPUP_CAP)}.`,
      403,
    );
  }
  return {
    id: newId("ord"),
    amount,
    status: "awaiting_transfer",
    mock: true,
    transfer: {
      bank: "Example Bank (mock)",
      accountNumber: "0000000000",
      accountName: "MOCK ON-RAMP — DO NOT PAY",
      reference: `AGT-${randomBytes(3).toString("hex").toUpperCase()}`,
    },
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
}
