import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { handlePayload, type WaPayload } from "@/server/whatsapp/handler";

// A model turn can take up to 35s. Work done in after() counts toward this too.
export const maxDuration = 60;

/** Meta's one-time webhook handshake. */
export async function GET(req: NextRequest) {
  if (!config.whatsapp.enabled) return new NextResponse("Not found", { status: 404 });
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && challenge && token === config.whatsapp.verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Meta calls this for every inbound message and button tap. */
export async function POST(req: NextRequest) {
  if (!config.whatsapp.enabled) return NextResponse.json({ ok: false }, { status: 404 });

  // Signature covers the exact raw body. Parse JSON only after it checks out.
  const raw = Buffer.from(await req.arrayBuffer());
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", config.whatsapp.appSecret).update(raw).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: WaPayload;
  try {
    payload = JSON.parse(raw.toString("utf8")) as WaPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Answer 200 right away so Meta doesn't retry; do the work after the response.
  after(() => handlePayload(payload));
  return NextResponse.json({ ok: true });
}
