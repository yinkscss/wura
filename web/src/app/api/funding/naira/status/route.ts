import { topUpStatus } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { signedIn } from "@/server/route";

// GET ?id=<top-up id>. Where a live top-up has got to, in plain states.
export const GET = signedIn(async (s, req) =>
  topUpStatus(s, { id: req.nextUrl.searchParams.get("id") ?? "", partnerToken: await partnerToken() }),
);
