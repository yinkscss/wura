import { handleMessage } from "@/server/agent";
import { connectReply } from "@/server/rules";
import { respondToConnect } from "@/server/site-connect";
import { authed, jsonBody } from "@/server/route";

// Answer to "Connect to this site?": { requestId, connect, remember }.
// Returns the chat reply (a signing preview, or a refusal). On a real network the
// agent carries on from here: it reads the site and prepares the call.
export const maxDuration = 60;

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const r = respondToConnect(s, { requestId: String(b.requestId ?? ""), connect: b.connect, remember: b.remember });
  if (r.kind === "connected") {
    const what = r.request.want ? ` and ${r.request.want}` : "";
    return handleMessage(s, `Go ahead and connect to ${r.request.host}${what}. I've allowed it.`);
  }
  return connectReply(r);
});
