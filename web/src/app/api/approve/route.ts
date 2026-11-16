import { openApproval } from "@/server/money";
import { authed, jsonBody } from "@/server/route";
import { refreshLiveAction } from "@/server/site-connect";

// Body: { id }. Opens a preview from an approval link. POST, not GET, because
// an expired preview is rebuilt (fresh checks) and that changes state.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const opened = await openApproval(s, String(b.id ?? ""));
  // A real site call that expired while the person was on their way is simulated again, not trusted.
  if (opened.kind === "site" && opened.action.live && opened.action.status === "expired") await refreshLiveAction(s, opened.action);
  return opened;
});
