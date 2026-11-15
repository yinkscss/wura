import "server-only";
import { cookies } from "next/headers";
import type { PartnerSession, RampCurrency } from "./types";

/**
 * The partner session lives in an httpOnly cookie that is only sent to the
 * funding routes. It proves to the partner that the user owns their wallet;
 * it can start a top-up page and read that user's top-ups, nothing else. It is
 * re-checked against the signed-in wallet on every use (see ./link.ts). Each
 * top-up choice signs in to its own partner service, so each has its own cookie.
 */
const name = (receive: RampCurrency) => `wura_partner_${receive.toLowerCase()}`;
const PATH = "/api/funding";

export async function partnerToken(receive: RampCurrency) {
  return (await cookies()).get(name(receive))?.value;
}

export async function keepPartnerSession(receive: RampCurrency, p: PartnerSession) {
  (await cookies()).set(name(receive), p.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: Math.max(0, Math.floor((p.expiresAt - Date.now()) / 1000)),
  });
}
