import type { Env } from "./env";
import type { AdDetails } from "./hotness";
import { formatAdMessage } from "./hotness";

interface LinkPreviewOptions {
  is_disabled?: boolean;
  url?: string;
  prefer_large_media?: boolean;
  show_above_text?: boolean;
}

async function postMessage(
  env: Env,
  chatId: string,
  text: string,
  replyMarkup?: unknown,
  linkPreviewOptions: LinkPreviewOptions = { is_disabled: true }
): Promise<Response> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: linkPreviewOptions,
      reply_markup: replyMarkup,
    }),
  });
}

// One retry on transient failures (network blip, Telegram 5xx) — a single
// dropped notification is the whole point we're trying to avoid, and a
// retry is cheap compared to silently losing it.
export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  text: string,
  replyMarkup?: unknown,
  linkPreviewOptions?: LinkPreviewOptions
): Promise<void> {
  let res = await postMessage(env, chatId, text, replyMarkup, linkPreviewOptions);
  if (!res.ok) {
    res = await postMessage(env, chatId, text, replyMarkup, linkPreviewOptions);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage to ${chatId} failed: ${res.status} ${body}`);
  }
}

// Sends the same message to every subscriber independently, so one chat
// failing (bot blocked, account deleted) doesn't stop delivery to the rest.
// Returns one error string per failed chat.
export async function broadcastTelegramMessage(
  env: Env,
  chatIds: string[],
  text: string
): Promise<string[]> {
  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(env, chatId, text);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return errors;
}

async function sendTelegramListing(env: Env, chatId: string, ad: AdDetails): Promise<void> {
  const linkPreviewOptions: LinkPreviewOptions = ad.photoUrls.length
    ? {
        url: ad.link,
        prefer_large_media: true,
        show_above_text: false,
      }
    : { is_disabled: true };

  // A silent Telegram message can still create a separate push entry. Keep
  // each listing to one sendMessage call and let Telegram render Kufar's link
  // preview, so the notification always contains the useful text card.
  await sendTelegramMessage(env, chatId, formatAdMessage(ad), undefined, linkPreviewOptions);
}

export async function broadcastTelegramListing(
  env: Env,
  chatIds: string[],
  ad: AdDetails
): Promise<string[]> {
  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramListing(env, chatId, ad);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return errors;
}

// Acknowledges a button tap so Telegram stops showing the client-side
// "loading" spinner on it. Best-effort — a failure here doesn't affect the
// filter change that already happened.
export async function answerCallbackQuery(env: Env, callbackQueryId: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => undefined);
}

// Rewrites an existing message's text/keyboard in place — used to reflect a
// filter change on the same panel the user just tapped, instead of sending
// a new message every time.
export async function editMessageText(
  env: Env,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: unknown
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Telegram returns 400 "message is not modified" when the tapped button
    // didn't actually change anything (e.g. re-picking the same bucket) —
    // that's a no-op, not a real failure.
    if (!body.includes("message is not modified")) {
      throw new Error(`Telegram editMessageText for ${chatId} failed: ${res.status} ${body}`);
    }
  }
}
