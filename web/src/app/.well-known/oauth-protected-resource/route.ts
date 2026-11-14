import { connection } from "next/server";
import { CORS, json, protectedResourceMetadata } from "@/server/oauth-http";

// RFC 9728 protected resource metadata for /mcp.
export async function GET(req: Request) {
  await connection();
  return json(protectedResourceMetadata(req));
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
