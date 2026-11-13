import { createSend } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

// Body: { intentId, approve: true }. Limits and balance are re-checked here.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return createSend(s, { intentId: String(b.intentId ?? ""), approve: b.approve });
});
