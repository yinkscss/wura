import { handleMessage, type ChatTurn } from "@/server/agent";
import { ApiFailure } from "@/server/errors";
import { jsonBody, signedIn } from "@/server/route";

// A message can take a few model calls; each tool call locks the wallet on its own.
export const maxDuration = 60;

export const POST = signedIn(async (s, req) => {
  const b = await jsonBody(req);
  const message = String(b.message ?? "");
  if (message.length > 500) throw new ApiFailure("BAD_REQUEST", "That message is too long.");
  const history: ChatTurn[] = Array.isArray(b.history)
    ? b.history
        .slice(-20)
        .filter((t): t is ChatTurn => !!t && typeof t === "object" && (t.role === "user" || t.role === "agent") && typeof t.text === "string")
    : [];
  return handleMessage(s, message, history);
});
