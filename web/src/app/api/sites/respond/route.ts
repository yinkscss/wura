import { handleMessage } from "@/server/agent";
import { connectReply } from "@/server/rules";
import { respondToConnect } from "@/server/site-connect";
import { signedIn, jsonBody } from "@/server/route";
import { withWallet } from "@/server/store";

// Answer to "Connect to this site?": { requestId, connect, remember }.
// Returns the chat reply (a signing preview, or a refusal). On a real network the
// agent carries on from here: it reads the site and prepares the call.
// The wallet lock covers only the permission step, so it is saved before the
// agent runs (and the agent's own tool calls take the lock themselves).
export const maxDuration = 60;

export const POST = signedIn(async (s, req) => {
  const b = await jsonBody(req);
  const r = await withWallet(s.userId, async () =>
    respondToConnect(s, { requestId: String(b.requestId ?? ""), connect: b.connect, remember: b.remember }),
  );
  if (r.kind === "connected" && b.quiet === true) {
    // Answered from an approval page for an assistant (Claude, ChatGPT): that assistant carries on.
    return { text: `Allowed. Go back to your assistant and ask it to carry on with ${r.request.host}.` };
  }
  if (r.kind === "connected") {
    const what = r.request.want ? ` and ${r.request.want}` : "";
    return handleMessage(s, `Go ahead and connect to ${r.request.host}${what}. I've allowed it.`);
  }
  return connectReply(r);
});
