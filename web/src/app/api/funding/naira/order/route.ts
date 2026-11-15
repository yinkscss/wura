import { receiveChoice, startTopUp } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody } from "@/server/route";

// Body: { amount, receive? }. The user pays naira; `receive` ("NGN" or "USDC",
// from the options in /api/funding/naira/info) is what lands in the wallet, and
// `amount` is in that currency, minor units. Default: the first option.
// Answers a top-up order, or { status: "needs_partner_signin", hash, … }: sign
// the hash with the wallet, post it to ./signin, then call this again.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const receive = receiveChoice(b.receive);
  return startTopUp(s, { amount: Number(b.amount), receive, partnerToken: await partnerToken(receive) });
});
