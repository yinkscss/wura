import { startTopUp } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody } from "@/server/route";

// Body: { amount } in the currency /api/funding/naira/info names, minor units.
// Answers a top-up order, or { status: "needs_partner_signin", hash, … }: sign
// the hash with the wallet, post it to ./signin, then call this again.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return startTopUp(s, { amount: Number(b.amount), partnerToken: await partnerToken() });
});
