import "server-only";
import { money, usdc } from "@/lib/format";
import { handleMessage, type ChatTurn } from "../agent";
import { approveSendFromChat, approveSwapFromChat, cancelQuote, cancelSend } from "../channel";
import { config } from "../config";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { approveSiteAction, cancelSiteAction, respondToConnect } from "../site-connect";
import { withWallet } from "../store";
import { sessionForUser } from "../users";
import { answerCallback, editMessage, sendMessage, sendTyping } from "./api";
import { addToHistory, allowMessage, consumeLinkCode, firstSight, getHistory, linkedUserId, unlinkUser } from "./links";
import { parseButton, renderCard, renderReply } from "./render";

/**
 * Telegram updates → the chat brain, and button taps → channel.ts.
 *
 * Money only moves from a button tap by the linked Telegram user, for an id
 * that exists in that user's own wallet. Free text never approves anything.
 * The model turn is not wrapped in withWallet (handleMessage locks the wallet
 * per tool call); only the button handlers lock around their one call.
 */

export type TgUser = { id: number };
export type TgMessage = { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
export type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

const MAX_MESSAGE_CHARS = 500;

const HELP = [
  "I'm Wura. I can change naira and dollars, send USDC to your favourites or a Stellar address, make payment links and show your balance.",
  "Try: \"rates for 50k\", \"send $5 to Isaac\" or \"balance\".",
  "I only prepare things. Money moves when you tap Approve.",
  "/unlink disconnects this chat.",
].join("\n");

function connectHelp() {
  const where = config.telegram.appUrl ? `${config.telegram.appUrl}/channels` : "the Wura web app (Channels)";
  return `This chat isn't connected to a Wura wallet yet. Sign in at ${where} and tap Connect Telegram.`;
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  try {
    if (typeof update.update_id !== "number" || !(await firstSight(update.update_id))) return;
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (err) {
    // Never log message text, ids or addresses.
    console.error("telegram: update failed:", err instanceof Error ? err.message : "unknown error");
  }
}

/** The Session for a linked Telegram user, built from their current `users` row. */
async function sessionFor(telegramUserId: number): Promise<{ linked: boolean; session: Session | null }> {
  const userId = await linkedUserId(telegramUserId);
  if (!userId) return { linked: false, session: null };
  return { linked: true, session: await sessionForUser(userId) };
}

const SIGN_IN_AGAIN = "I can't find your Wura account details. Sign in to Wura on the web once more, then try again.";

async function onMessage(m: TgMessage) {
  // Private chats only: ignore groups and channels.
  if (m.chat.type !== "private" || !m.from) return;
  const chatId = m.chat.id;
  const tgId = m.from.id;
  const text = typeof m.text === "string" ? m.text.trim() : "";
  if (!text) {
    await sendMessage(chatId, "I can only read text messages.");
    return;
  }

  const command = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";

  if (command === "/start") {
    const code = text.split(/\s+/)[1];
    if (code) {
      const userId = await consumeLinkCode(code, tgId);
      if (!userId) {
        await sendMessage(chatId, "That link expired or was already used. Make a new one on the Channels page in Wura.");
        return;
      }
      if (!(await sessionForUser(userId))) {
        await unlinkUser(userId);
        await sendMessage(chatId, SIGN_IN_AGAIN);
        return;
      }
      await sendMessage(chatId, `You're connected. ${HELP}`);
      return;
    }
    const { linked } = await sessionFor(tgId);
    await sendMessage(chatId, linked ? HELP : connectHelp());
    return;
  }
  if (command === "/help") {
    await sendMessage(chatId, HELP);
    return;
  }
  if (command === "/unlink") {
    const userId = await linkedUserId(tgId);
    if (userId) await unlinkUser(userId);
    await sendMessage(chatId, userId ? "Disconnected. This chat can no longer see or use your wallet." : "This chat wasn't connected.");
    return;
  }

  const { linked, session } = await sessionFor(tgId);
  if (!linked) {
    await sendMessage(chatId, connectHelp());
    return;
  }
  if (!session) {
    await sendMessage(chatId, SIGN_IN_AGAIN);
    return;
  }
  if (!(await allowMessage(tgId))) {
    await sendMessage(chatId, "You're sending messages very fast. Give me a minute and try again.");
    return;
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    await sendMessage(chatId, "That message is too long. Keep it under 500 characters.");
    return;
  }

  const message = command === "/balance" ? "What's my balance?" : text;
  void sendTyping(chatId).catch(() => {});
  let rendered;
  try {
    const history: ChatTurn[] = await getHistory(tgId);
    rendered = renderReply(await handleMessage(session, message, history));
  } catch (err) {
    console.error("telegram: reply failed:", err instanceof Error ? err.message : "unknown error");
    await sendMessage(chatId, "Something went wrong. Nothing was sent. Try again in a moment.");
    return;
  }
  await sendMessage(chatId, rendered.text, rendered.keyboard);
  await addToHistory(tgId, [
    { role: "user", text: message },
    { role: "agent", text: rendered.text },
  ]);
}

// ---------- Button taps ----------

async function onCallback(cq: TgCallbackQuery) {
  const msg = cq.message;
  if (!msg || msg.chat.type !== "private") {
    await answerCallback(cq.id, "That message is too old. Ask me again.").catch(() => {});
    return;
  }
  const button = parseButton(cq.data);
  if (!button) {
    await answerCallback(cq.id).catch(() => {});
    return;
  }
  const { linked, session } = await sessionFor(cq.from.id);
  if (!linked || !session) {
    await answerCallback(cq.id, linked ? "Sign in to Wura on the web again." : "This chat isn't connected to Wura.").catch(() => {});
    return;
  }

  let outcome: string;
  let followUp: ReturnType<typeof renderCard> | null = null;
  try {
    const r = await withWallet(session.userId, () => runButton(session, button.action, button.id));
    outcome = r.outcome;
    followUp = r.followUp ?? null;
  } catch (err) {
    outcome = err instanceof ApiFailure ? err.message : "Something went wrong. Nothing was sent.";
    if (!(err instanceof ApiFailure)) console.error("telegram: button failed:", err instanceof Error ? err.message : "unknown error");
  }

  await answerCallback(cq.id).catch(() => {});
  // Remove the buttons so the same card can't be tapped twice, and show what happened.
  const body = [msg.text, outcome].filter(Boolean).join("\n\n");
  await editMessage(msg.chat.id, msg.message_id, body).catch(() => sendMessage(msg.chat.id, outcome));
  if (followUp) await sendMessage(msg.chat.id, followUp.text, followUp.keyboard);
}

type ButtonResult = { outcome: string; followUp?: ReturnType<typeof renderCard> };

async function runButton(s: Session, action: string, id: string): Promise<ButtonResult> {
  const isSend = id.startsWith("snd_");
  const isSwap = id.startsWith("q_");
  switch (action) {
    case "ap": {
      if (isSend) {
        const r = await approveSendFromChat(s, id);
        if (r.status !== "done") throw new ApiFailure("SIGNING_UNAVAILABLE", "I couldn't finish that from chat. Nothing was sent.");
        const link = "activity" in r && r.activity?.explorerUrl ? `\n${r.activity.explorerUrl}` : "";
        return { outcome: `Sent ${usdc(r.intent.amount)} to ${r.intent.to.name}.${r.mock ? " (Mock mode: nothing was broadcast.)" : ""}${link}` };
      }
      if (isSwap) {
        const r = await approveSwapFromChat(s, id);
        return { outcome: `Swapped ${money(r.quote.amountIn, r.quote.from)} → ${money(r.quote.amountOut, r.quote.to)}.${r.mock ? " (Mock mode: nothing was broadcast.)" : ""}` };
      }
      throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
    }
    case "cx": {
      if (isSend) cancelSend(s, id);
      else if (isSwap) cancelQuote(s, id);
      else throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
      return { outcome: "Cancelled. Nothing was sent." };
    }
    case "sc":
    case "sd": {
      const r = respondToConnect(s, { requestId: id, connect: action === "sc", remember: false });
      if (r.kind === "action") return { outcome: "Connected for this request.", followUp: renderCard({ type: "site-action", action: r.action }) };
      return { outcome: "Okay, I won't connect." };
    }
    case "sa": {
      const r = await approveSiteAction(s, { actionId: id, approve: true });
      return { outcome: `Done: ${r.action.siteName} · ${r.action.call.fn}.${r.mock ? " (Mock mode: nothing was broadcast.)" : ""}` };
    }
    case "sx": {
      cancelSiteAction(s, id);
      return { outcome: "Cancelled. Nothing was signed." };
    }
  }
  throw new ApiFailure("BAD_REQUEST", "That button isn't valid any more. Ask me again.");
}
