import "server-only";
import { randomBytes } from "node:crypto";
import { ApiFailure } from "../errors";
import { newId, wallet } from "../store";
import type { RampProvider } from "./types";

/**
 * The mock naira partner. Nothing real happens: no identity check runs, no
 * bank details are real, and no money moves. It keeps every screen working
 * with no secrets set.
 *
 * Rules it models (docs/kyc-and-funding.md):
 *   - KYC is never bypassed. A naira top-up needs a passed identity check.
 *   - We store only that the check passed (a verified status), never the NIN.
 */

/** Example bounds. Real ones come from the live partner. */
const EXAMPLE_MIN = 1_000_00;
/** Example flat cash-out fee. */
const EXAMPLE_CASH_OUT_FEE = 200_00;

function requireVerified(userId: string, what: string) {
  if (wallet(userId).kycStatus !== "verified") {
    throw new ApiFailure("KYC_REQUIRED", `Naira ${what} need an identity check first. USDC needs no ID.`, 403);
  }
}

export const mockRamp: RampProvider = {
  id: "mock",
  live: false,
  identityCheck: "wura_mock",

  async limits() {
    return {
      topUp: { enabled: true, min: EXAMPLE_MIN, max: null },
      cashOut: { enabled: true, min: EXAMPLE_MIN, max: null },
    };
  },

  /** Validates the format only, then forgets the number. */
  verifyIdentity(s, input) {
    const nin = String(input.nin ?? "").replace(/\s+/g, "");
    if (input.consent !== true) {
      throw new ApiFailure("BAD_REQUEST", "Please agree to the identity check to continue.");
    }
    if (!/^\d{11}$/.test(nin)) {
      throw new ApiFailure("BAD_REQUEST", "A NIN is 11 digits. Check the number and try again.");
    }
    const w = wallet(s.userId);
    w.kycStatus = "verified";
    return { kycStatus: w.kycStatus };
  },

  async startTopUp(s, { amount }) {
    requireVerified(s.userId, "top-ups");
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
  },

  async previewCashOut(s, { amount }) {
    requireVerified(s.userId, "cash-outs");
    return {
      id: newId("out"),
      amount,
      fee: EXAMPLE_CASH_OUT_FEE,
      receive: amount - EXAMPLE_CASH_OUT_FEE,
      expiresAt: Date.now() + 60 * 1000,
      mock: true,
    };
  },

  async quote() {
    return null;
  },
};
