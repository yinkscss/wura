import { approveSendFromChat } from "@/server/channel";
import { ApiFailure } from "@/server/errors";
import { authed, jsonBody } from "@/server/route";

/**
 * Local testing only: stands in for a chat app's Approve button until the
 * Telegram bot exists. Off unless ALLOW_DEV_ROUTES=1, and never on Vercel.
 */
export const POST = authed(async (s, req) => {
  if (process.env.ALLOW_DEV_ROUTES !== "1" || process.env.VERCEL) {
    throw new ApiFailure("BAD_REQUEST", "Not found.", 404);
  }
  const b = await jsonBody(req);
  return approveSendFromChat(s, String(b.intentId ?? ""));
});
