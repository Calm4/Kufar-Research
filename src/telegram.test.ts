import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "./env";
import { broadcastTelegramListing, sendTelegramMessage } from "./telegram";
import type { AdDetails } from "./hotness";

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

function listing(photoUrls: string[]): AdDetails {
  return {
    id: "1",
    source: "kufar",
    cityId: "gomel",
    link: "https://re.kufar.by/vi/1",
    priceUsd: 276,
    priceByn: 850,
    exchangeRateBynPerUsd: 3.08,
    rooms: 2,
    address: "Ветковская ул, 2, Гомель",
    distanceKm: 0.7,
    photoCount: 15,
    photoUrls,
  };
}

test("broadcastTelegramListing sends one text card with a large Kufar preview", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  };

  try {
    const errors = await broadcastTelegramListing(
      { TELEGRAM_BOT_TOKEN: "test-token" } as Env,
      ["123"],
      listing(["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg", "https://img/4.jpg"])
    );
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /sendMessage$/);
  assert.match(String(requests[0].body.text), /🟢\[Kufar\] Цена: <b>850р \(276 USD\)<\/b>/);
  assert.match(String(requests[0].body.text), /Адрес: <b>Ветковская ул\., 2<\/b>/);
  assert.deepEqual(requests[0].body.link_preview_options, {
    url: "https://re.kufar.by/vi/1",
    prefer_large_media: true,
    show_above_text: false,
  });
});

test("broadcastTelegramListing disables the preview when there are no photos", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  };

  try {
    const errors = await broadcastTelegramListing(
      { TELEGRAM_BOT_TOKEN: "test-token" } as Env,
      ["123"],
      { ...listing([]), photoCount: 0 }
    );
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map(({ url }) => url.split("/").pop()), ["sendMessage"]);
  assert.deepEqual(requests[0].body.link_preview_options, { is_disabled: true });
});
