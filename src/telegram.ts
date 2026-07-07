import type { Env } from "./env";

async function postMessage(env: Env, chatId: string, text: string): Promise<Response> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// One retry on transient failures (network blip, Telegram 5xx) — a single
// dropped notification is the whole point we're trying to avoid, and a
// retry is cheap compared to silently losing it.
export async function sendTelegramMessage(env: Env, chatId: string, text: string): Promise<void> {
  let res = await postMessage(env, chatId, text);
  if (!res.ok) {
    res = await postMessage(env, chatId, text);
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
