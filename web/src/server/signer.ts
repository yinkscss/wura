import "server-only";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { ApiFailure } from "./errors";

/**
 * Signs and submits a money move. Only called by src/server/money.ts, and only
 * after the server has checked: the user approved this exact quote or preview,
 * it has not expired or been used, it is within the per-payment and daily
 * caps, and the balance covers it.
 *
 * v1 is mock only: nothing is signed or broadcast, and the reference returned
 * is clearly marked MOCK.
 *
 * Testnet path (not wired yet, gated by MONEY_MODE=testnet):
 *   1. Build the Stellar transaction (path payment / payment) on the server.
 *   2. Ask Privy to sign it with the user's Stellar wallet. Stellar is a Privy
 *      Tier 2 chain: Privy signs the hash, and we submit to Horizon ourselves.
 *   3. Submit to Horizon testnet and return the transaction hash.
 *
 * Chat channels (Telegram, WhatsApp, MCP) — future, see docs/auth.md:
 *   The user signs in once on the web. We then add a scoped session signer on
 *   the same wallet, limited to the per-payment and daily caps (and, where the
 *   provider supports it, to allowed assets and an expiry). The server may only
 *   use it for approved, in-limit actions. Never hold an unscoped key.
 */

export type MoveKind = "swap" | "send";

export type SignRequest = {
  kind: MoveKind;
  userAddress: string;
  description: string;
};

export type SignResult = { txRef: string; mock: boolean };

export async function signAndSubmit(req: SignRequest): Promise<SignResult> {
  if (config.moneyMode === "testnet") {
    // Refuse rather than pretend. Wire the Privy Tier 2 signer before enabling.
    throw new ApiFailure(
      "SIGNING_UNAVAILABLE",
      "Testnet signing is not wired in this version. Unset MONEY_MODE to use mock mode.",
      503,
    );
  }
  void req;
  return { txRef: `MOCK-${randomBytes(6).toString("hex").toUpperCase()}`, mock: true };
}
