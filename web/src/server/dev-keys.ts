import "server-only";
import { createHmac } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { config, serverDevSigning } from "./config";

/**
 * TESTNET_SIGNER=server-dev only. Derives a throwaway Stellar testnet key per
 * email from DEV_KEY_SECRET (or SESSION_SECRET), so the same email gets the
 * same address after a restart. This is custodial and exists only so the team
 * can demo and test real testnet flows without Privy. It refuses to run
 * anywhere but testnet.
 */
export function devKeypairFor(email: string) {
  if (!serverDevSigning() || config.stellarNetwork !== "testnet") {
    throw new Error("Dev keys are only available with MONEY_MODE=testnet and TESTNET_SIGNER=server-dev.");
  }
  const secret = process.env.DEV_KEY_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("DEV_KEY_SECRET or SESSION_SECRET (32+ chars) is required for dev keys.");
  const seed = createHmac("sha256", secret).update(`wura-testnet-dev-key:${email.toLowerCase()}`).digest();
  return Keypair.fromRawEd25519Seed(seed);
}
