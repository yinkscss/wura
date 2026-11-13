import { addAllowedSite, getSites, removeAllowedSite } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

// Allow list: GET lists allowed sites and open "Connect to this site?" requests.
export const GET = authed((s) => getSites(s));

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return addAllowedSite(s, String(b.host ?? ""));
});

export const DELETE = authed(async (s, req) => {
  const b = await jsonBody(req);
  return removeAllowedSite(s, String(b.host ?? ""));
});
