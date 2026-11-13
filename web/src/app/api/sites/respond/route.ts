import { connectReply } from "@/server/agent";
import { respondToConnect } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

// Answer to "Connect to this site?": { requestId, connect, remember }.
// Returns the chat reply (a signing preview, or a refusal).
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return connectReply(respondToConnect(s, { requestId: String(b.requestId ?? ""), connect: b.connect, remember: b.remember }));
});
