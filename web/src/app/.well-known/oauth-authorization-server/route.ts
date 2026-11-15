import { connection } from "next/server";
import { authServerMetadata, CORS, json } from "@/server/oauth-http";

// RFC 8414 authorization server metadata.
export async function GET(req: Request) {
  await connection();
  return json(authServerMetadata(req));
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
