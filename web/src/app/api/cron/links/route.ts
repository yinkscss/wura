import { NextResponse, type NextRequest } from "next/server";
import { refuseUnlessCron } from "@/server/cron-auth";
import { refreshAllLinks } from "@/server/paylinks-watch";

/**
 * Checks every open payment link on Horizon. Call it on a schedule (a Vercel
 * cron or any scheduler) with `Authorization: Bearer $CRON_SECRET`. Without
 * CRON_SECRET set the route is off.
 */
export async function GET(req: NextRequest) {
  const no = refuseUnlessCron(req);
  if (no) return no;
  return NextResponse.json(await refreshAllLinks());
}
