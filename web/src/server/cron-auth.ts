import "server-only";
import { NextResponse } from "next/server";
import { bearerMatches } from "./ops";

/** Guard for scheduler-only routes. Returns a 404 response to send back, or null when the caller may continue. */
export function refuseUnlessCron(req: Request): NextResponse | null {
  if (bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
