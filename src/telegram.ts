import type { Env } from "./env";

async function postMessage(env: Env, text: string): Promise<Response> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

// One retry on transient failures (network blip, Telegram 5xx) — a single
// dropped notification is the whole point we're trying to avoid, and a
// retry is cheap compared to silently losing it.
export async function sendTelegramMessage(env: Env, text: string): Promise<void> {
  let res = await postMessage(env, text);
  if (!res.ok) {
    res = await postMessage(env, text);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}
