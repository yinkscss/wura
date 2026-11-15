import { receiveChoice, topUpStatus } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { signedIn } from "@/server/route";

// GET ?id=<top-up id>&receive=<NGN|USDC>. Where a live top-up has got to, in plain states.
export const GET = signedIn(async (s, req) => {
  const q = req.nextUrl.searchParams;
  const receive = receiveChoice(q.get("receive"));
  return topUpStatus(s, { id: q.get("id") ?? "", receive, partnerToken: await partnerToken(receive) });
});
