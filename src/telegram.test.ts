import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "./env";
import { sendTelegramMessage } from "./telegram";

test("sendTelegramMessage enables HTML and disables link previews", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  try {
    await sendTelegramMessage(
      { TELEGRAM_BOT_TOKEN: "test-token" } as Env,
      "123",
      '<b>Цена</b> <a href="https://example.com">Открыть</a>'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = requestBody as Record<string, unknown> | null;
  assert.ok(body);
  assert.equal(body.parse_mode, "HTML");
  assert.deepEqual(body.link_preview_options, { is_disabled: true });
});
