"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
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
