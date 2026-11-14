import type { NextRequest } from "next/server";
import { OAuthError, baseUrl, checkAuthorize } from "@/server/oauth";
import { json } from "@/server/oauth-http";
import { getSession } from "@/server/session";

// For the consent page: is this /authorize request valid, and who's asking?
export async function GET(req: NextRequest) {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  try {
    const a = await checkAuthorize(params, baseUrl(req));
    const s = await getSession(req);
    return json({
      ok: true,
      signedIn: !!s,
      email: s?.email ?? null,
      clientName: a.client.client_name,
      redirectHost: new URL(a.redirectUri).host,
      scopes: a.scopes,
    });
  } catch (err) {
    if (err instanceof OAuthError) return json({ ok: false, error: err.message }, 400);
    throw err;
  }
}
