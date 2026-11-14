import { revokeApp } from "@/server/oauth";
import { authed, jsonBody } from "@/server/route";

// Revokes every token this app holds for the user. It has to ask to connect again.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return revokeApp(s.userId, String(b.clientId ?? ""));
});
