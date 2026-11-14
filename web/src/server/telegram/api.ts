import "server-only";
import { config } from "../config";

/**
 * Tiny Telegram Bot API client: only what the bot needs. The token comes from
 * the environment and is never logged. Errors carry Telegram's description but
 * never message text.
 */

export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][];

type TgResult<T> = { ok: true; result: T } | { ok: false; description?: string; error_code?: number };

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = config.telegram.token;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as TgResult<T> | null;
  if (!data || !data.ok) {
    throw new Error(`telegram ${method} failed: ${data && !data.ok ? (data.description ?? data.error_code) : res.status}`);
  }
  return data.result;
}

/** Telegram messages are capped at 4096 characters. */
export function clip(text: string) {
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export async function sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: clip(text),
    disable_web_page_preview: true,
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Replaces a message's text. Passing no keyboard removes the buttons. */
export async function editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  return call<unknown>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: clip(text),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard ?? [] },
  });
}

export async function answerCallback(callbackQueryId: string, text?: string) {
  return call<unknown>("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 190) } : {}) });
}

export async function sendTyping(chatId: number) {
  return call<unknown>("sendChatAction", { chat_id: chatId, action: "typing" });
}
