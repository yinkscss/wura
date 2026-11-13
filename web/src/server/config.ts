import "server-only";

/**
 * Runtime switches. Everything defaults to mock mode, so the app runs with no
 * secrets at all.
 *
 * - Auth: Privy email OTP when NEXT_PUBLIC_PRIVY_APP_ID is set, otherwise a
 *   mocked email sign-in (any 6-digit code).
 * - Money: always mock in this first version. MONEY_MODE=testnet is reserved
 *   for real Privy signing on Stellar testnet and is refused until the signer
 *   is wired (see src/server/signer.ts).
 */
export const config = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  get authMode(): "privy" | "mock" {
    return this.privyAppId ? "privy" : "mock";
  },
  moneyMode: (process.env.MONEY_MODE === "testnet" ? "testnet" : "mock") as
    | "mock"
    | "testnet",
  stellarNetwork: process.env.STELLAR_NETWORK === "public" ? "public" : "testnet",
  /** Comma-separated venue ids to treat as unreachable, e.g. "soroswap". For demos of the "venue down" path. */
  mockUnavailableVenues: (process.env.MOCK_UNAVAILABLE_VENUES || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
  /** How long a swap quote or send preview stays approvable. */
  quoteTtlMs: 60_000,
};

const DEV_SECRET = "agent-dev-session-secret-mock-mode-only-not-for-real-money";

/**
 * Secret used to sign the session cookie. In mock mode a fixed development
 * secret is fine (nothing real is protected). Anything beyond mock requires
 * SESSION_SECRET.
 */
export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (config.authMode === "privy" || config.moneyMode !== "mock") {
    throw new Error(
      "SESSION_SECRET (32+ characters) is required when Privy or testnet signing is enabled.",
    );
  }
  return new TextEncoder().encode(DEV_SECRET);
}
