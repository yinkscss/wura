#!/usr/bin/env node
// Points your Telegram bot at this app (or away from it).
//
//   node scripts/telegram-webhook.mjs set https://your-app.example.com
//   node scripts/telegram-webhook.mjs info
//   node scripts/telegram-webhook.mjs delete
//
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment or
// from .env.local. Never prints either value.
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local, rely on the environment
  }
}
loadEnvLocal();

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const [cmd, origin] = process.argv.slice(2);

async function tg(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN (environment or web/.env.local).");
  process.exit(1);
}

try {
  if (cmd === "set") {
    if (!secret || secret.length < 16) throw new Error("Set TELEGRAM_WEBHOOK_SECRET (16+ characters, letters, digits, _ or -).");
    if (!/^[A-Za-z0-9_-]+$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET may only use letters, digits, _ and -.");
    if (!origin || !origin.startsWith("https://")) throw new Error("Give the public https origin, e.g. https://your-app.example.com");
    await tg("setWebhook", {
      url: `${origin.replace(/\/+$/, "")}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    console.log("Webhook set.");
  } else if (cmd === "delete") {
    await tg("deleteWebhook", { drop_pending_updates: true });
    console.log("Webhook removed.");
  } else if (cmd === "info") {
    const i = await tg("getWebhookInfo");
    console.log({ url: i.url, pending: i.pending_update_count, last_error: i.last_error_message ?? null });
  } else {
    console.log("Usage: node scripts/telegram-webhook.mjs set <https-origin> | info | delete");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
