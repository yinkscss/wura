import { NextResponse, type NextRequest } from "next/server";
import { alert } from "@/server/alerts";
import { config, moneyKilled, moneyLive } from "@/server/config";
import { refuseUnlessCron } from "@/server/cron-auth";
import { STUCK_AFTER_MS } from "@/server/ops";
import { stuckSubmits } from "@/server/store";
import { sponsorshipConfigured, treasuryStatus } from "@/server/treasury";

/**
 * Health check for whoever runs Wura. Call it every few minutes with
 * `Authorization: Bearer $CRON_SECRET`. It returns the state of the money
 * system and raises an alert for a low treasury or a stuck transfer. Off
 * (404) when CRON_SECRET is unset. Shows no emails, user ids or secrets.
 */
export async function GET(req: NextRequest) {
  const no = refuseUnlessCron(req);
  if (no) return no;

  const out: Record<string, unknown> = {
    mode: config.moneyMode,
    network: config.stellarNetwork,
    live: moneyLive(),
    killed: moneyKilled(),
  };

  if (sponsorshipConfigured()) {
    try {
      const t = await treasuryStatus();
      out.treasury = { xlm: t.xlm, available: t.available, floor: t.minXlm, low: t.low, sponsoredAccounts: t.sponsoredAccounts, maxAccounts: t.maxAccounts };
      if (t.low) await alert("treasury_low", `${t.available.toFixed(2)} XLM free, floor ${t.minXlm}. Top up ${t.address}.`, "treasury");
    } catch {
      out.treasury = { error: "couldn't read the treasury from Horizon" };
    }
  }

  const stuck = await stuckSubmits(STUCK_AFTER_MS);
  out.stuckSubmits = stuck.length;
  if (stuck.length > 0) {
    await alert("stuck_transfer", `${stuck.length} submit${stuck.length === 1 ? "" : "s"} unconfirmed for over 10 minutes. First: ${stuck[0].slice(0, 12)}… See docs/runbook.md.`, "stuck");
  }
  return NextResponse.json(out);
}
