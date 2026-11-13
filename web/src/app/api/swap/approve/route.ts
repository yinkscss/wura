import { approveSwap } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

// Body: { quoteId, approve: true }. Without approve === true nothing is signed.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return approveSwap(s, { quoteId: String(b.quoteId ?? ""), approve: b.approve });
});
