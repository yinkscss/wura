import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { sessionSecret } from "./config";

export const SESSION_COOKIE = "agent_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

export type Session = {
  /** Stable user id: Privy DID, or "mock:<email>" in mock mode. */
  userId: string;
  email: string;
  /** The user's Stellar G… address. */
  address: string;
};

export async function createSessionToken(s: Session) {
  return new SignJWT({ email: s.email, address: s.address })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(sessionSecret());
}

export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.address !== "string") {
      return null;
    }
    return { userId: payload.sub, email: payload.email, address: payload.address };
  } catch {
    return null;
  }
}

export function getSession(req: NextRequest) {
  return readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};
