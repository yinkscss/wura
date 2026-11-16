import "server-only";
import { randomBytes } from "node:crypto";
import { moneyLive } from "./config";
import { ApiFailure } from "./errors";

/**
 * Signs and submits a money move. Only called by src/server/money.ts, and only
 * after the server has checked: the user approved this exact quote or preview,
 * it has not expired or been used, it is within the per-payment and daily
 * caps, and the balance covers it.
 *
 * Mock mode: nothing is signed or broadcast, and the reference returned is
 * clearly marked MOCK.
 *
 * Testnet mode: real USDC sends don't come through here. They use the
 * two-step flow in src/server/testnet.ts (build → the user's Privy wallet
 * signs the hash → we verify, re-check and submit to Horizon). Swaps and site
 * payments are refused on testnet before they reach this function, so the
 * guard below only fires if something is mis-wired.
 *
 * Chat channels (Telegram, WhatsApp, MCP) — future, see docs/auth.md:
 *   The user signs in once on the web. We then add a scoped session signer on
 *   the same wallet, limited to the per-payment and daily caps (and, where the
 *   provider supports it, to allowed assets and an expiry). The server may only
 *   use it for approved, in-limit actions. Never hold an unscoped key.
 */

export type MoveKind = "swap" | "send" | "site";

export type SignRequest = {
  kind: MoveKind;
  userAddress: string;
  description: string;
};

export type SignResult = { txRef: string; mock: boolean };

export async function signAndSubmit(req: SignRequest): Promise<SignResult> {
  if (moneyLive()) {
    // Refuse rather than pretend. Wire the Privy Tier 2 signer before enabling.
    throw new ApiFailure(
      "SIGNING_UNAVAILABLE",
      "This action isn't live yet. Only USDC sends are real so far.",
      503,
    );
  }
  void req;
  return { txRef: `MOCK-${randomBytes(6).toString("hex").toUpperCase()}`, mock: true };
}
