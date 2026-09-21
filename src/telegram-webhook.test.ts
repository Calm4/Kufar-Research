import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "./env";
import {
  CLEAR_FILTERS_BUTTON,
  CITY_BUTTON_PREFIX,
  FILTERS_BUTTON,
  SUBSCRIBE_BUTTON,
  UNSUBSCRIBE_BUTTON,
} from "./filter-ui";
import { getSubscriber } from "./subscribers";
import { handleTelegramWebhook } from "./telegram-webhook";

class MemoryKv {
  private readonly values = new Map<string, string>();

  constructor(subscribers: unknown) {
    this.values.set("subscribers", JSON.stringify(subscribers));
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function telegramRequest(text: string): Request {
  return new Request("https://worker.test/telegram-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { chat: { id: 42 }, text } }),
  });
}

test("main Telegram buttons unsubscribe, show filters, and clear filters", async () => {
  const kv = new MemoryKv([
    {
      chatId: "42",
      priceRanges: [{ max: 200 }],
      rooms: [1, 2],
    },
  ]);
  const env = {
    KUFAR_KV: kv as unknown as KVNamespace,
    TELEGRAM_BOT_TOKEN: "test-token",
  } as Env;
  const sentBodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  };

  try {
    assert.equal((await handleTelegramWebhook(telegramRequest(UNSUBSCRIBE_BUTTON), env)).status, 200);
    assert.equal((await getSubscriber(env.KUFAR_KV, "42"))?.active, false);
    assert.deepEqual(
      (sentBodies.at(-1)?.reply_markup as { keyboard: string[][] }).keyboard[0],
      [SUBSCRIBE_BUTTON]
    );

    assert.equal((await handleTelegramWebhook(telegramRequest(FILTERS_BUTTON), env)).status, 200);
    const filtersMarkup = sentBodies.at(-1)?.reply_markup as { inline_keyboard?: unknown[][] };
    assert.ok(filtersMarkup.inline_keyboard);

    assert.equal((await handleTelegramWebhook(telegramRequest(CLEAR_FILTERS_BUTTON), env)).status, 200);
    const cleared = await getSubscriber(env.KUFAR_KV, "42");
    assert.equal(cleared?.priceRanges, undefined);
    assert.equal(cleared?.rooms, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("city button opens the selector and /city saves the selected city", async () => {
  const kv = new MemoryKv([{ chatId: "42" }]);
  const env = {
    KUFAR_KV: kv as unknown as KVNamespace,
    TELEGRAM_BOT_TOKEN: "test-token",
  } as Env;
  const sentBodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  };

  try {
    await handleTelegramWebhook(telegramRequest(`${CITY_BUTTON_PREFIX} Гомель`), env);
    const cityMarkup = sentBodies.at(-1)?.reply_markup as { inline_keyboard?: unknown[][] };
    assert.equal(cityMarkup.inline_keyboard?.flat().length, 6);

    await handleTelegramWebhook(telegramRequest("/city Брест"), env);
    assert.equal((await getSubscriber(env.KUFAR_KV, "42"))?.cityId, "brest");
    assert.match(String(sentBodies.at(-1)?.text), /Город сохранён: Брест/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
