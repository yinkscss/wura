import "server-only";
import type { AgentCard, AgentReply } from "@/lib/types";
import { encodeButton as encodeShared, parseButton as parseShared } from "../channels/buttons";
import { cardView, replyView, type CardButtonAction } from "../channels/card-text";
import type { InlineKeyboard } from "./api";

/**
 * Turns the chat brain's reply into a Telegram message: plain text and inline
 * buttons. Uses the shared card-text core; only the keyboard format is Telegram.
 *
 * Button data is "<action>:<id>", at most 64 bytes (Telegram's cap).
 */

export type Rendered = { text: string; keyboard?: InlineKeyboard };
export type ButtonAction = CardButtonAction;

const MAX_CALLBACK_BYTES = 64;

export function encodeButton(action: ButtonAction, id: string): string {
  return encodeShared(action, id, MAX_CALLBACK_BYTES);
}

export function parseButton(data: unknown): { action: ButtonAction; id: string } | null {
  return parseShared(data, MAX_CALLBACK_BYTES);
}

function toKeyboard(buttons?: { label: string; action: CardButtonAction; id: string }[]): InlineKeyboard | undefined {
  if (!buttons?.length) return undefined;
  return [
    buttons.map((b) => ({
      text: b.label.slice(0, 64),
      callback_data: encodeButton(b.action, b.id),
    })),
  ];
}

export function renderCard(card: AgentCard): Rendered {
  const view = cardView(card);
  return { text: view.text, keyboard: toKeyboard(view.buttons) };
}

export function renderReply(reply: AgentReply): Rendered {
  const view = replyView(reply);
  return { text: view.text, keyboard: toKeyboard(view.buttons) };
}
