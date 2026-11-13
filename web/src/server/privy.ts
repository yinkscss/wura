import "server-only";
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey } from "jose";
import { config } from "./config";
import { ApiFailure } from "./errors";
import { isAccountId } from "./strkey";

let verifier: CryptoKey | JWTVerifyGetKey | null = null;

/**
 * The key Privy signs access tokens with (ES256). Preferred: the PEM
 * "Verification key" from Privy Dashboard > Configuration > App settings,
 * set as PRIVY_VERIFICATION_KEY. Fallback: Privy's per-app JWKS endpoint.
 */
async function getVerifier() {
  if (verifier) return verifier;
  const pem = process.env.PRIVY_VERIFICATION_KEY?.replace(/\\n/g, "\n").trim();
  verifier = pem
    ? await importSPKI(pem, "ES256")
    : createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${config.privyAppId}/jwks.json`));
  return verifier;
}

/** Verifies a Privy access token and returns the Privy user id (DID). */
export async function verifyPrivyAccessToken(token: string): Promise<string> {
  if (!config.privyAppId) throw new ApiFailure("BAD_REQUEST", "Privy is not configured.");
  try {
    const key = await getVerifier();
    const { payload } = await jwtVerify(token, key as CryptoKey, {
      issuer: "privy.io",
      audience: config.privyAppId,
    });
    if (!payload.sub) throw new Error("missing sub");
    return payload.sub;
  } catch {
    throw new ApiFailure("UNAUTHENTICATED", "Your sign-in could not be verified. Please try again.", 401);
  }
}

type PrivyLinkedAccount = { type?: string; chain_type?: string; address?: string; email?: string };

/**
 * With PRIVY_APP_SECRET set, confirm on the server that the Stellar address
 * and email really belong to this Privy user. Without it (mock money mode),
 * the client-reported address is accepted, which is fine because nothing is
 * signed. Real signing must always resolve the wallet server-side.
 */
export async function resolvePrivyUser(
  userId: string,
  claimed: { address: string; email: string },
): Promise<{ address: string; email: string }> {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) {
    if (config.moneyMode !== "mock") {
      throw new ApiFailure("SIGNING_UNAVAILABLE", "PRIVY_APP_SECRET is required outside mock mode.", 503);
    }
    if (!isAccountId(claimed.address)) {
      throw new ApiFailure("BAD_REQUEST", "That isn't a Stellar account address.");
    }
    return claimed;
  }
  // Privy REST API: GET https://api.privy.io/v1/users/{user_id}, Basic auth app ID : app secret.
  const res = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.privyAppId}:${secret}`).toString("base64")}`,
      "privy-app-id": config.privyAppId,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ApiFailure("UNAUTHENTICATED", "Could not load your account from Privy.", 401);
  const user = (await res.json()) as { linked_accounts?: PrivyLinkedAccount[] };
  const accounts = user.linked_accounts ?? [];
  const stellar = accounts.find(
    (a) => a.type === "wallet" && a.chain_type === "stellar" && a.address === claimed.address,
  );
  if (!stellar?.address) throw new ApiFailure("UNAUTHENTICATED", "That wallet isn't linked to your account.", 401);
  const email = accounts.find((a) => a.type === "email")?.address ?? claimed.email;
  return { address: stellar.address, email };
}
