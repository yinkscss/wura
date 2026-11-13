import { cancelSiteAction } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return cancelSiteAction(s, String(b.actionId ?? ""));
});
