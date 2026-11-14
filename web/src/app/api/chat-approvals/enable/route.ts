import { enableChatApprovals } from "@/server/agent-key";
import { authed } from "@/server/route";

// Returns needs_signature: the user's own wallet signs adding the agent key.
export const POST = authed((s) => enableChatApprovals(s));
