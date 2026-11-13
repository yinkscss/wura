import { requestSiteConnect } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return requestSiteConnect(s, { url: String(b.url ?? ""), want: String(b.want ?? "") });
});
