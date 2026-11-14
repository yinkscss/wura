import { baseUrl, exchange } from "@/server/oauth";
import { CORS, json, oauthError } from "@/server/oauth-http";

// Token endpoint: authorization_code (PKCE S256) and refresh_token (rotating).
export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") || "";
    const form = type.includes("application/json")
      ? new URLSearchParams(Object.entries((await req.json()) as Record<string, string>))
      : new URLSearchParams(await req.text());
    return json(await exchange(form, baseUrl(req)));
  } catch (err) {
    return oauthError(err);
  }
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
