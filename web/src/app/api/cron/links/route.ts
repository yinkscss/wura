import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { refreshAllLinks } from "@/server/paylinks-watch";

/**
 * Checks every open payment link on Horizon. Call it on a schedule (a Vercel
 * cron or any scheduler) with `Authorization: Bearer $CRON_SECRET`. Without
 * CRON_SECRET set the route is off.
 */
export async function GET(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await refreshAllLinks());
}
