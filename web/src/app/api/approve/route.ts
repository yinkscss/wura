import { openApproval } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

// Body: { id }. Opens a preview from an approval link. POST, not GET, because
// an expired preview is rebuilt (fresh checks) and that changes state.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return openApproval(s, String(b.id ?? ""));
});
