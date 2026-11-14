import "server-only";
import { OAuthError, SCOPES, baseUrl, resourceFor } from "./oauth";

/** Shared HTTP bits for the OAuth endpoints (CORS for metadata, JSON errors). */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra },
  });
}

export function oauthError(err: unknown) {
  if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status);
  console.error("oauth error", err instanceof Error ? err.message : err);
  return json({ error: "server_error", error_description: "Something went wrong." }, 500);
}

export function protectedResourceMetadata(req: Request) {
  const base = baseUrl(req);
  return {
    resource: resourceFor(base),
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Wura",
  };
}

export function authServerMetadata(req: Request) {
  const base = baseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}
