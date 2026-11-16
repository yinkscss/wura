import { NextResponse, type NextRequest } from "next/server";
import { refuseUnlessCron } from "@/server/cron-auth";
import { reconcile } from "@/server/ramp/reconcile";

/**
 * Brings stored top-ups and cash-outs in step with the partner. Call it every
 * few minutes from a scheduler with `Authorization: Bearer $CRON_SECRET`; off
 * (404) when CRON_SECRET is unset. Safe to run twice. The answer has counts
 * only (no user ids, addresses or tokens); `stuck` is what to alert on, and
 * `stuck.cashoutsInProgress` needs a person and docs/runbook.md.
 */
export async function GET(req: NextRequest) {
  const no = refuseUnlessCron(req);
  if (no) return no;
  return NextResponse.json(await reconcile());
}
