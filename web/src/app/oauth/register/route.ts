import { registerClient } from "@/server/oauth";
import { CORS, json, oauthError } from "@/server/oauth-http";

// RFC 7591 dynamic client registration. Public clients; known redirect URIs only.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const c = await registerClient(body);
    return json(
      {
        client_id: c.client_id,
        client_id_issued_at: Math.floor(new Date(c.created_at).getTime() / 1000),
        client_name: c.client_name,
        redirect_uris: c.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  } catch (err) {
    return oauthError(err);
  }
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
