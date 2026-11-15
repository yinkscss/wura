import "server-only";
import { cookies } from "next/headers";
import type { PartnerSession } from "./types";

/**
 * The partner session lives in an httpOnly cookie that is only sent to the
 * funding routes. It proves to the partner that the user owns their wallet;
 * it can start a top-up page and read that user's top-ups, nothing else. It is
 * re-checked against the signed-in wallet on every use (see ./link.ts).
 */
const NAME = "wura_partner";
const PATH = "/api/funding";

export async function partnerToken() {
  return (await cookies()).get(NAME)?.value;
}

export async function keepPartnerSession(p: PartnerSession) {
  (await cookies()).set(NAME, p.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: Math.max(0, Math.floor((p.expiresAt - Date.now()) / 1000)),
  });
}
