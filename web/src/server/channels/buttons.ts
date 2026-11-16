import "server-only";
import type { CardButtonAction } from "./card-text";

/**
 * Encode / parse Approve-style button payloads shared by chat channels.
 * Telegram caps callback data at 64 bytes; WhatsApp allows up to 256.
 */

const ACTIONS = new Set<string>(["ap", "cx", "sc", "sd", "sa", "sx"]);

export function encodeButton(action: CardButtonAction, id: string, maxBytes = 256): string {
  const data = `${action}:${id}`;
  if (Buffer.byteLength(data) > maxBytes) throw new Error("callback data too long");
  return data;
}

export function parseButton(
  data: unknown,
  maxBytes = 256,
): { action: CardButtonAction; id: string } | null {
  if (typeof data !== "string" || Buffer.byteLength(data) > maxBytes) return null;
  const i = data.indexOf(":");
  if (i < 1) return null;
  const action = data.slice(0, i);
  const id = data.slice(i + 1);
  if (!ACTIONS.has(action) || !/^[A-Za-z0-9_-]{1,50}$/.test(id)) return null;
  return { action: action as CardButtonAction, id };
}
