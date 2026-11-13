import { NextResponse, type NextRequest } from "next/server";
import { config, privySigning, serverDevSigning } from "@/server/config";
import { devKeypairFor } from "@/server/dev-keys";
import { ApiFailure, errorResponse } from "@/server/errors";
import { jsonBody } from "@/server/route";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/server/session";
import { randomMockAddress } from "@/server/strkey";

// Mock email sign-in, only when Privy is not configured.
// Any 6-digit code is accepted. No email is sent.
export async function POST(req: NextRequest) {
  try {
    if (config.authMode !== "mock") {
      throw new ApiFailure("BAD_REQUEST", "Mock sign-in is off because Privy is configured.", 404);
    }
    if (privySigning()) {
      throw new ApiFailure(
        "SIGNING_UNAVAILABLE",
        "Testnet mode with Privy signing needs NEXT_PUBLIC_PRIVY_APP_ID. For local testing without Privy, set TESTNET_SIGNER=server-dev.",
        503,
      );
    }
    const body = await jsonBody(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiFailure("BAD_REQUEST", "Enter a valid email address.");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new ApiFailure("BAD_REQUEST", "The code is 6 digits.");
    }
    const token = await createSessionToken({
      userId: `mock:${email}`,
      email,
      // server-dev: a throwaway testnet key derived from the email, so the address is real.
      address: serverDevSigning() ? devKeypairFor(email).publicKey() : randomMockAddress(),
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
