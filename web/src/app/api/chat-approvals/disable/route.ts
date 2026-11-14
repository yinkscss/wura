import { disableChatApprovals } from "@/server/agent-key";
import { authed } from "@/server/route";

// Returns needs_signature: the user's own wallet signs removing the agent key.
export const POST = authed((s) => disableChatApprovals(s));
