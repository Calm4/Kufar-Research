import type { Env } from "./env";
import { addSubscriber } from "./subscribers";
import { sendTelegramMessage } from "./telegram";

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

// Handles Telegram's webhook POST — the only place that turns an incoming
// /start into a stored subscription. Always replies 200 so Telegram doesn't
// treat this as a delivery failure and keep retrying the same update.
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("ok");
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (chatId === undefined || chatId === null || !text?.startsWith("/start")) {
    return new Response("ok");
  }

  const chatIdStr = String(chatId);
  const isNew = await addSubscriber(env.KUFAR_KV, chatIdStr);
  const reply = isNew
    ? "Подписка оформлена — сюда будут приходить новые объявления с Kufar."
    : "Вы уже подписаны.";
  try {
    await sendTelegramMessage(env, chatIdStr, reply);
  } catch {
    // Subscription is already saved; a failed confirmation isn't worth
    // failing the webhook response over.
  }

  return new Response("ok");
}
