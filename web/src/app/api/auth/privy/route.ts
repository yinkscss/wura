import { NextResponse, type NextRequest } from "next/server";
import { ApiFailure, errorResponse } from "@/server/errors";
import { resolvePrivyUser, verifyPrivyAccessToken } from "@/server/privy";
import { jsonBody } from "@/server/route";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/server/session";
import { upsertUser } from "@/server/users";

// Exchanges a verified Privy access token (email OTP login) plus the user's
// Privy Stellar wallet address for our own session cookie.
export async function POST(req: NextRequest) {
  try {
    const body = await jsonBody(req);
    const accessToken = String(body.accessToken ?? "");
    if (!accessToken) throw new ApiFailure("BAD_REQUEST", "Missing access token.");
    const userId = await verifyPrivyAccessToken(accessToken);
    const { address, email } = await resolvePrivyUser(userId, {
      address: String(body.address ?? ""),
      email: String(body.email ?? ""),
    });
    await upsertUser({ userId, email, address });
    const token = await createSessionToken({ userId, email, address });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
