import { finishPartnerSignIn, receiveChoice } from "@/server/ramp";
import { keepPartnerSession } from "@/server/ramp/cookie";
import { jsonBody, signedIn } from "@/server/route";

// Body: { receive, challenge, signature } — the challenge and receive from "needs_partner_signin"
// and the wallet's signature over its hash. The server checks the challenge
// again before using the signature. Signing it can't move money.
export const POST = signedIn(async (s, req) => {
  const b = await jsonBody(req);
  const receive = receiveChoice(b.receive);
  await keepPartnerSession(receive, await finishPartnerSignIn(s, { receive, challenge: b.challenge, signature: b.signature }));
  return { status: "signed_in" as const };
});
