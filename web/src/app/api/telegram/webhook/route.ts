import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { handleUpdate, type TgUpdate } from "@/server/telegram/handler";

// A model turn can take up to 35s. Work done in after() counts toward this too.
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Telegram calls this for every message and button tap (see scripts/telegram-webhook.mjs). */
export async function POST(req: NextRequest) {
  if (!config.telegram.enabled) return NextResponse.json({ ok: false }, { status: 404 });

  // Constant-time check of the secret Telegram echoes back in this header.
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqual(digest(given), digest(config.telegram.webhookSecret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!update || typeof update !== "object" || typeof update.update_id !== "number") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Answer 200 right away so Telegram doesn't retry; do the work after the response.
  after(() => handleUpdate(update));
  return NextResponse.json({ ok: true });
}
