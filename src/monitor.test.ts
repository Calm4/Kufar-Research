import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "./env";
import { runMonitor } from "./monitor";

class MemoryKv {
  readonly values = new Map<string, string>();

  constructor(entries: Record<string, unknown>) {
    for (const [key, value] of Object.entries(entries)) {
      this.values.set(key, JSON.stringify(value));
    }
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function kufarHtml(): string {
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      ads: [
        {
          ad_id: 123456,
          ad_link: "https://re.kufar.by/vi/gomel/snyat/kvartiru/123456",
          ad_parameters: [{ p: "rooms", v: "2" }],
          account_parameters: [{ p: "address", v: "Советская ул, 1, Гомель" }],
          calculator: [
            { currency: "USD", price: 20000 },
            { currency: "BYN", price: 60000 },
          ],
          images: [],
        },
      ],
    },
  })}</script>`;
}

function realtHtml(): string {
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      objects: [
        {
          code: 654321,
          priceRates: { 840: 250, 933: 750 },
          rooms: 2,
          address: "Гомель Кирова ул. 1",
          images: [],
        },
      ],
    },
  })}</script>`;
}

function moyaHtml(): string {
  return `
    <div class="one_advert_list" idAds="777777">
      <div class="title"><a>1-ком. квартира</a></div>
      <div class="address">ул. Советская, д. 2</div>
      <div class="price">700 руб.</div>
    </div>
  `;
}

test("deployment migration keeps old Kufar history and silently baselines new feeds", async () => {
  const kv = new MemoryKv({
    subscribers: [{ chatId: "42" }],
    seen_ids: ["123456"],
  });
  const env = {
    KUFAR_KV: kv as unknown as KVNamespace,
    MAX_SEEN_IDS: "800",
    TELEGRAM_BOT_TOKEN: "test-token",
  } as Env;
  const originalFetch = globalThis.fetch;
  let telegramCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.nbrb.by")) {
      return Response.json({ Cur_Scale: 1, Cur_OfficialRate: 3 });
    }
    if (url.includes("re.kufar.by")) return new Response(kufarHtml());
    if (url.includes("realt.by")) return new Response(realtHtml());
    if (url.includes("moyareklama.by")) return new Response(moyaHtml());
    if (url.includes("api.telegram.org")) {
      telegramCalls += 1;
      return new Response("{}");
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await runMonitor(env);
    assert.equal(result.feeds.length, 3);
    assert.equal(result.foundIds.length, 3);
    assert.deepEqual(result.newIds, []);
    assert.equal(result.blocked, false);
    assert.equal(telegramCalls, 0);
    assert.equal(kv.values.get("seen_ids:kufar:gomel"), JSON.stringify(["123456"]));
    assert.equal(kv.values.get("seen_ids:realt:gomel"), JSON.stringify(["654321"]));
    assert.equal(kv.values.get("seen_ids:moya:gomel"), JSON.stringify(["777777"]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
