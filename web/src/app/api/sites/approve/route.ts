import { approveSiteAction } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

// Body: { actionId, approve: true }. Limits and balance are re-checked here.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return approveSiteAction(s, { actionId: String(b.actionId ?? ""), approve: b.approve });
});
