"use client";

import { useCallback } from "react";
import { useStellarHashSigner } from "@/components/providers";
import { api, ClientApiError } from "./api";
import type { NeedsSignature } from "./types";

/**
 * Finishes any API response that needs the user's wallet signature:
 * signs the transaction hash with Privy, then hands the signature back to our
 * server, which verifies it, re-checks limits and submits to Stellar.
 */
export function useCompleteSigning() {
  const signer = useStellarHashSigner();
  return useCallback(
    async <T,>(res: T | NeedsSignature): Promise<T> => {
      const r = res as NeedsSignature;
      if (!r || r.status !== "needs_signature") return res as T;
      if (!signer) {
        throw new ClientApiError("SIGNING_UNAVAILABLE", "This transaction needs your Privy wallet, but Privy isn't configured.", 503);
      }
      let signature: string;
      try {
        signature = await signer(r.address, r.hash);
      } catch {
        throw new ClientApiError("NOT_APPROVED", "Your wallet didn't sign, so nothing was sent.", 403);
      }
      return api<T>("/api/tx/submit", { txId: r.txId, signature });
    },
    [signer],
  );
}
