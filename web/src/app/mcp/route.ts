import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/server/mcp";
import { baseUrl, verifyAccessToken } from "@/server/oauth";
import { CORS } from "@/server/oauth-http";
import { sessionForUser } from "@/server/users";

// Wura's remote MCP endpoint (Streamable HTTP, stateless). OAuth bearer required.
export const maxDuration = 60;

// Claude and ChatGPT call from their servers (often no Origin). Browsers that
// do send one must be one of these, per the MCP transport spec.
const ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com", "https://chatgpt.com"];

function unauthorized(req: Request, invalid: boolean) {
  const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  const challenge = `Bearer resource_metadata="${meta}", scope="wura.read wura.prepare"${invalid ? ', error="invalid_token"' : ""}`;
  return new Response(JSON.stringify({ error: invalid ? "invalid_token" : "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": challenge, ...CORS, "access-control-expose-headers": "www-authenticate" },
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(baseUrl(req)).origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response("Forbidden origin", { status: 403 });
  }
  const auth = req.headers.get("authorization") || "";
  const raw = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!raw) return unauthorized(req, false);
  const grant = await verifyAccessToken(raw, baseUrl(req));
  if (!grant) return unauthorized(req, true);
  const session = await sessionForUser(grant.userId);
  if (!session) return unauthorized(req, true);

  const server = buildMcpServer(session, grant.scopes, baseUrl(req));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
export const DELETE = GET;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
