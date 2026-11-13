import { cancelSend } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return cancelSend(s, String(b.intentId ?? ""));
});
