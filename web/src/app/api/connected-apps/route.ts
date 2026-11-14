import { connectedApps } from "@/server/oauth";
import { authed } from "@/server/route";

// Apps (Claude, ChatGPT…) with live access to this user's Wura via the MCP connector.
export const GET = authed((s) => connectedApps(s.userId));
