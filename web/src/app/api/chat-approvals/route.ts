import { chatApprovalStatus } from "@/server/agent-key";
import { authed } from "@/server/route";

export const GET = authed((s) => chatApprovalStatus(s));
