"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import type { ReactNode } from "react";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_ENABLED = Boolean(PRIVY_APP_ID);

export function Providers({ children }: { children: ReactNode }) {
  if (!PRIVY_ENABLED) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#08318D" },
        // We create the Stellar wallet ourselves after login (extended chain).
        embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

/** Logs out of Privy too when it's configured; a no-op in mock mode. */
export function usePrivyLogout(): () => Promise<void> {
  // PRIVY_ENABLED is a build-time constant, so the hook order never changes.
  if (!PRIVY_ENABLED) return async () => {};
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePrivy().logout;
}

/**
 * Signs a Stellar transaction hash with the user's Privy Stellar wallet
 * (Privy Tier 2: Privy signs the raw hash, our server attaches it and submits).
 * Returns null when Privy isn't configured.
 */
export function useStellarHashSigner(): ((address: string, hashHex: string) => Promise<string>) | null {
  if (!PRIVY_ENABLED) return null;
  // PRIVY_ENABLED is a build-time constant, so the hook order never changes.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { signRawHash } = useSignRawHash();
  return async (address, hashHex) => {
    const { signature } = await signRawHash({ address, chainType: "stellar", hash: `0x${hashHex.replace(/^0x/, "")}` });
    return signature;
  };
}
