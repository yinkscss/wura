import { finishPartnerSignIn } from "@/server/ramp";
import { keepPartnerSession } from "@/server/ramp/cookie";
import { jsonBody, signedIn } from "@/server/route";

// Body: { challenge, signature } — the challenge from "needs_partner_signin"
// and the wallet's signature over its hash. The server checks the challenge
// again before using the signature. Signing it can't move money.
export const POST = signedIn(async (s, req) => {
  const b = await jsonBody(req);
  await keepPartnerSession(await finishPartnerSignIn(s, { challenge: b.challenge, signature: b.signature }));
  return { status: "signed_in" as const };
});
