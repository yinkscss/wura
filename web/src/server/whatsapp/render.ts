import "server-only";
import type { AgentCard, AgentReply } from "@/lib/types";
import { encodeButton as encodeShared, parseButton as parseShared } from "../channels/buttons";
import { cardView, replyView, type CardButtonAction } from "../channels/card-text";
import type { ReplyButton } from "./api";

/**
 * Shared card-text → WhatsApp interactive reply buttons. Site-connect cards are
 * left as plain text (WhatsApp v1 skips site connect).
 */

export type WaRendered = { text: string; buttons?: ReplyButton[] };
export type ButtonAction = CardButtonAction;

const MAX_BUTTON_ID = 256;

export function encodeButton(action: ButtonAction, id: string): string {
  return encodeShared(action, id, MAX_BUTTON_ID);
}

export function parseButton(data: unknown): { action: ButtonAction; id: string } | null {
  return parseShared(data, MAX_BUTTON_ID);
}

function toButtons(buttons?: { label: string; action: CardButtonAction; id: string }[]): ReplyButton[] | undefined {
  if (!buttons?.length) return undefined;
  // Skip site-connect buttons on WhatsApp for now (docs/whatsapp.md).
  const money = buttons.filter((b) => b.action === "ap" || b.action === "cx");
  if (!money.length) return undefined;
  return money.map((b) => ({ id: encodeButton(b.action, b.id), title: b.label.slice(0, 20) }));
}

export function renderCard(card: AgentCard): WaRendered {
  if (card.type === "site-permission" || card.type === "site-action") {
    const view = cardView(card);
    return { text: `${view.text}\n\nSite connect from WhatsApp isn't available yet. Open Wura on the web to continue.` };
  }
  const view = cardView(card);
  return { text: view.text, buttons: toButtons(view.buttons) };
}

export function renderReply(reply: AgentReply): WaRendered {
  if (!reply.card) return { text: reply.text };
  if (reply.card.type === "site-permission" || reply.card.type === "site-action") {
    const card = renderCard(reply.card);
    return { text: [reply.text, card.text].filter(Boolean).join("\n\n") };
  }
  const view = replyView(reply);
  return { text: view.text, buttons: toButtons(view.buttons) };
}
