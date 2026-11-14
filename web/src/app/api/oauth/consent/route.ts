import type { NextRequest } from "next/server";
import { OAuthError, baseUrl, checkAuthorize, denyRedirect, issueCode } from "@/server/oauth";
import { json } from "@/server/oauth-http";
import { getSession } from "@/server/session";

// The signed-in user answered the consent page. Body: { query, allow }.
// Re-validates everything, then returns where to send the browser.
export async function POST(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return json({ error: "Please sign in first." }, 401);
  // Same-origin only: the consent answer must come from our own page.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(baseUrl(req)).origin && origin !== req.nextUrl.origin) {
    return json({ error: "Wrong origin." }, 403);
  }
  const body = (await req.json().catch(() => ({}))) as { query?: string; allow?: boolean };
  try {
    const a = await checkAuthorize(new URLSearchParams(String(body.query ?? "")), baseUrl(req));
    const redirect = body.allow === true ? await issueCode(s.userId, a) : denyRedirect(a);
    return json({ redirect });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.message }, 400);
    throw err;
  }
}
