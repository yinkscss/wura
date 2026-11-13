import { handleMessage } from "@/server/agent";
import { ApiFailure } from "@/server/errors";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const message = String(b.message ?? "");
  if (message.length > 500) throw new ApiFailure("BAD_REQUEST", "That message is too long.");
  return handleMessage(s, message);
});
