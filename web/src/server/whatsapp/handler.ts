import "server-only";
import { money, usdc } from "@/lib/format";
import { handleMessage, type ChatTurn } from "../agent";
import { approveSendFromChat, approveSwapFromChat, cancelQuote, cancelSend } from "../channel";
import { config, moneyLive } from "../config";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { withWallet } from "../store";
import { sessionForUser } from "../users";
import { sendButtons, sendCtaUrl, sendText } from "./api";
import {
  addToHistory,
  allowMessage,
  consumeLinkCode,
  firstSight,
  getHistory,
  linkedUserId,
  normalizePhone,
  unlinkByPhone,
  unlinkUser,
} from "./links";
import { parseButton, renderReply } from "./render";

/**
 * WhatsApp webhook payloads → the chat brain, and button taps → channel.ts.
 *
 * WhatsApp only carries messages. Money moves only from a button tap by the
 * number linked to the wallet that owns that quote or intent. Free text never
 * approves. Session is built from the sender's linked number.
 */

export type WaMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
};

export type WaValue = {
  messages?: WaMessage[];
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  metadata?: { phone_number_id?: string };
};

export type WaPayload = {
  object?: string;
  entry?: { changes?: { value?: WaValue; field?: string }[] }[];
};

const MAX_MESSAGE_CHARS = 500;

const HELP = [
  "I'm Wura. I can change naira and dollars, send USDC to your favourites or a Stellar address, make payment links and show your balance.",
  'Try: "rates for 50k", "send $5 to Isaac" or "balance".',
  "I only prepare things. Money moves when you tap Approve.",
  'Say "unlink" to disconnect this number.',
].join("\n");

function connectHelp() {
  const where = config.whatsapp.appUrl ? `${config.whatsapp.appUrl}/channels` : "the Wura web app (Channels)";
  return `This chat isn't connected to a Wura wallet yet. Sign in at ${where} and tap Connect WhatsApp.`;
}

const SIGN_IN_AGAIN = "I can't find your Wura account details. Sign in to Wura on the web once more, then try again.";

/** Process one Meta webhook body (may contain several messages). */
export async function handlePayload(payload: WaPayload): Promise<void> {
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return;
  const ourNumberId = config.whatsapp.phoneNumberId;
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value?.messages?.length) continue;
      // Ignore events for other numbers on the same WABA / app.
      const incomingId = value.metadata?.phone_number_id;
      if (ourNumberId && incomingId && incomingId !== ourNumberId) continue;
      for (const msg of value.messages) {
        try {
          await handleMessageEvent(msg);
        } catch (err) {
          console.error("whatsapp: message failed:", err instanceof Error ? err.message : "unknown error");
        }
      }
    }
  }
}

async function handleMessageEvent(msg: WaMessage): Promise<void> {
  const wamid = typeof msg.id === "string" ? msg.id : "";
  if (!wamid || !(await firstSight(wamid))) return;

  const phone = normalizePhone(msg.from ?? "");
  if (!phone) return;

  // Rate-limit every inbound event (linked or not) so a flood can't burn Meta
  // send quota on connect/help replies. Over limit: stay silent.
  if (!(await allowMessage(phone))) return;

  const buttonId = buttonPayload(msg);
  if (buttonId) {
    await onButton(phone, buttonId);
    return;
  }

  if (msg.type && msg.type !== "text") {
    await sendText(phone, "I can only read text messages for now.");
    return;
  }

  const text = typeof msg.text?.body === "string" ? msg.text.body.trim() : "";
  if (!text) {
    await sendText(phone, "I can only read text messages.");
    return;
  }

  await onText(phone, text);
}

function buttonPayload(msg: WaMessage): string | null {
  if (msg.type === "interactive" && msg.interactive?.button_reply?.id) return msg.interactive.button_reply.id;
  if (msg.type === "button" && msg.button?.payload) return msg.button.payload;
  return null;
}

async function sessionFor(phone: string): Promise<{ linked: boolean; session: Session | null }> {
  const userId = await linkedUserId(phone);
  if (!userId) return { linked: false, session: null };
  return { linked: true, session: await sessionForUser(userId) };
}

async function reply(phone: string, text: string, buttons?: { id: string; title: string }[]) {
  if (buttons?.length) await sendButtons(phone, text, buttons);
  else await sendText(phone, text);
}

async function onText(phone: string, text: string) {
  const lower = text.toLowerCase();

  // Link code: short token from the Channels page (base64url, no spaces).
  if (/^[A-Za-z0-9_-]{16,64}$/.test(text) && !text.includes(" ")) {
    const userId = await consumeLinkCode(text, phone);
    if (userId) {
      if (!(await sessionForUser(userId))) {
        await unlinkUser(userId);
        await sendText(phone, SIGN_IN_AGAIN);
        return;
      }
      await sendText(phone, `You're connected. ${HELP}`);
      return;
    }
    const { linked } = await sessionFor(phone);
    if (!linked) {
      await sendText(phone, "That link expired or was already used. Make a new one on the Channels page in Wura.");
      return;
    }
    // Already linked: fall through in case it was a short normal message.
  }

  if (lower === "help" || lower === "/help") {
    await sendText(phone, HELP);
    return;
  }
  if (lower === "unlink" || lower === "/unlink" || lower === "disconnect") {
    const removed = await unlinkByPhone(phone);
    await sendText(
      phone,
      removed ? "Disconnected. This number can no longer see or use your wallet." : "This chat wasn't connected.",
    );
    return;
  }

  const { linked, session } = await sessionFor(phone);
  if (!linked) {
    await sendText(phone, connectHelp());
    return;
  }
  if (!session) {
    await sendText(phone, SIGN_IN_AGAIN);
    return;
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    await sendText(phone, "That message is too long. Keep it under 500 characters.");
    return;
  }

  const message = lower === "balance" || lower === "/balance" ? "What's my balance?" : text;
  let rendered;
  try {
    const history: ChatTurn[] = await getHistory(phone);
    rendered = renderReply(await handleMessage(session, message, history));
  } catch (err) {
    console.error("whatsapp: reply failed:", err instanceof Error ? err.message : "unknown error");
    await sendText(phone, "Something went wrong. Nothing was sent. Try again in a moment.");
    return;
  }
  await reply(phone, rendered.text, rendered.buttons);
  await addToHistory(phone, [
    { role: "user", text: message },
    { role: "agent", text: rendered.text },
  ]);
}

async function onButton(phone: string, rawId: string) {
  const button = parseButton(rawId);
  if (!button) {
    await sendText(phone, "That button isn't valid any more. Ask me again.");
    return;
  }

  const { linked, session } = await sessionFor(phone);
  if (!linked || !session) {
    await sendText(phone, linked ? "Sign in to Wura on the web again." : "This chat isn't connected to Wura.");
    return;
  }

  // Session comes from this phone's link only — withWallet then scopes the
  // quote/intent to that wallet, so another user's id is simply not found.
  try {
    const outcome = await withWallet(session.userId, () => runButton(session, button.action, button.id));
    if (outcome.cta) {
      await sendCtaUrl(phone, outcome.text, outcome.cta.label, outcome.cta.url);
    } else {
      await sendText(phone, outcome.text);
    }
  } catch (err) {
    const msg = err instanceof ApiFailure ? err.message : "Something went wrong. Nothing was sent.";
    if (!(err instanceof ApiFailure)) console.error("whatsapp: button failed:", err instanceof Error ? err.message : "unknown error");
    await sendText(phone, msg);
  }
}

type ButtonOutcome = { text: string; cta?: { label: string; url: string } };

async function runButton(s: Session, action: string, id: string): Promise<ButtonOutcome> {
  const isSend = id.startsWith("snd_");
  const isSwap = id.startsWith("q_");
  const web = config.whatsapp.appUrl;

  switch (action) {
    case "ap": {
      if (isSend) {
        try {
          const r = await approveSendFromChat(s, id);
          if (r.status !== "done") {
            throw new ApiFailure("SIGNING_UNAVAILABLE", "I couldn't finish that from chat. Nothing was sent.");
          }
          const link = "activity" in r && r.activity?.explorerUrl ? `\n${r.activity.explorerUrl}` : "";
          return {
            text: `Sent ${usdc(r.intent.amount)} to ${r.intent.to.name}.${r.mock ? " (Mock mode: nothing was broadcast.)" : ""}${link}`,
          };
        } catch (err) {
          if (err instanceof ApiFailure && err.code === "CHAT_APPROVAL_OFF" && web) {
            return {
              text: `${err.message}\n\nOr open Wura on the web to approve this send.`,
              cta: { label: "Open Wura", url: `${web}/approve/${id}` },
            };
          }
          throw err;
        }
      }
      if (isSwap) {
        if (moneyLive()) {
          const url = web ? `${web}/approve/${id}` : "";
          return {
            text: url
              ? "Swaps need your wallet to sign on testnet, so finish this one in Wura on the web. Nothing was swapped from WhatsApp."
              : "Swaps need your wallet to sign on testnet. Open Wura on the web to approve. Nothing was swapped from WhatsApp.",
            ...(url ? { cta: { label: "Approve in Wura", url } } : {}),
          };
        }
        const r = await approveSwapFromChat(s, id);
        return {
          text: `Swapped ${money(r.quote.amountIn, r.quote.from)} → ${money(r.quote.amountOut, r.quote.to)}.${r.mock ? " (Mock mode: nothing was broadcast.)" : ""}`,
        };
      }
      throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
    }
    case "cx": {
      if (isSend) cancelSend(s, id);
      else if (isSwap) cancelQuote(s, id);
      else throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
      return { text: "Cancelled. Nothing was sent." };
    }
  }
  throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
}
