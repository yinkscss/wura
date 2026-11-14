import { connectedApps } from "@/server/oauth";
import { signedIn } from "@/server/route";

// Apps (Claude, ChatGPT…) with live access to this user's Wura via the MCP connector.
export const GET = signedIn((s) => connectedApps(s.userId));
