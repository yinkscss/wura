import "server-only";
import { config } from "../config";

/**
 * Tiny Meta WhatsApp Cloud API client. Token stays in env; errors never include
 * message bodies or phone numbers.
 */

type WaResult = { messages?: { id: string }[]; error?: { message?: string; code?: number } };

async function call(body: Record<string, unknown>): Promise<{ id?: string }> {
  const { accessToken, phoneNumberId, graphVersion } = config.whatsapp;
  if (!accessToken || !phoneNumberId) throw new Error("WhatsApp is not configured.");
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as WaResult | null;
  if (!res.ok || data?.error) {
    throw new Error(`whatsapp send failed: ${data?.error?.code ?? res.status}`);
  }
  return { id: data?.messages?.[0]?.id };
}

/** WhatsApp text is capped; keep replies readable. */
export function clip(text: string) {
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export type ReplyButton = { id: string; title: string };

export async function sendText(to: string, text: string) {
  return call({
    to,
    type: "text",
    text: { preview_url: true, body: clip(text) },
  });
}

/** Interactive reply buttons: at most 3, titles ≤ 20 chars, ids ≤ 256. */
export async function sendButtons(to: string, body: string, buttons: ReplyButton[]) {
  const cleaned = buttons.slice(0, 3).map((b) => ({
    type: "reply" as const,
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }));
  return call({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(body) },
      action: { buttons: cleaned },
    },
  });
}

/** CTA URL button (Meta): opens the web app; tap is not reported to the webhook. */
export async function sendCtaUrl(to: string, body: string, displayText: string, url: string) {
  return call({
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: clip(body) },
      action: {
        name: "cta_url",
        parameters: { display_text: displayText.slice(0, 20), url },
      },
    },
  });
}
