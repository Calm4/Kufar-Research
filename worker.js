const DEFAULT_SEARCH_URL =
  "https://re.kufar.by/l/gomel/snyat/kvartiru?cur=USD&size=30";
const SEEN_IDS_KEY = "seen_ids";
const MAX_SEEN_IDS = 800;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

async function fetchSearchPage(searchUrl) {
  const response = await fetch(searchUrl, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(
      `Kufar responded with ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}

// Listing links look like:
//   /vi/gomel/snyat/kvartiru/123456
//   /vi/gomel/snyat/kvartiru/v-novostrojke/123456
// JSON embedded in the page may escape slashes as "\/", so we normalize
// those first and match on the normalized string.
function extractListings(html) {
  const normalized = html.replace(/\\\//g, "/");
  const re = /\/vi\/([a-z0-9-]+\/snyat\/kvartiru\/(?:[a-z0-9-]+\/)?(\d+))/gi;
  const listings = new Map(); // id -> path
  let match;
  while ((match = re.exec(normalized)) !== null) {
    const [, path, id] = match;
    if (!listings.has(id)) {
      listings.set(id, `/vi/${path}`);
    }
  }
  return listings;
}

async function getSeenIds(kv) {
  const raw = await kv.get(SEEN_IDS_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveSeenIds(kv, idsSet) {
  const trimmed = Array.from(idsSet).slice(-MAX_SEEN_IDS);
  await kv.put(SEEN_IDS_KEY, JSON.stringify(trimmed));
}

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    console.error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
  return res.ok;
}

async function checkForNewListings(env) {
  const searchUrl = env.SEARCH_URL || DEFAULT_SEARCH_URL;
  const html = await fetchSearchPage(searchUrl);
  const listings = extractListings(html);
  const seenIds = await getSeenIds(env.KUFAR_KV);

  const newListings = [];
  for (const [id, path] of listings) {
    if (!seenIds.has(id)) newListings.push({ id, path });
  }

  if (newListings.length > 0) {
    for (const { id } of newListings) seenIds.add(id);
    await saveSeenIds(env.KUFAR_KV, seenIds);
  }

  return { totalFound: listings.size, newListings };
}

async function notifyNewListings(env, newListings) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("Telegram credentials are not set, skipping notifications");
    return false;
  }
  for (const { id, path } of newListings) {
    const url = `https://re.kufar.by${path}`;
    const text = `Новое объявление об аренде\nID: ${id}\n${url}`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text);
  }
  return true;
}

async function runCheckAndNotify(env) {
  const { totalFound, newListings } = await checkForNewListings(env);
  if (newListings.length > 0) {
    await notifyNewListings(env, newListings);
  }
  return { totalFound, newListings };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runCheckAndNotify(env)
        .then(({ totalFound, newListings }) => {
          console.log(`Kufar check: found=${totalFound} new=${newListings.length}`);
        })
        .catch((err) => console.error("Scheduled Kufar check failed:", err))
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/check") {
      try {
        const { totalFound, newListings } = await runCheckAndNotify(env);
        const lines = [
          "Kufar monitor — manual check",
          `Search URL: ${env.SEARCH_URL || DEFAULT_SEARCH_URL}`,
          `Найдено объявлений на странице: ${totalFound}`,
          `Новых (ранее не встречавшихся): ${newListings.length}`,
        ];
        if (newListings.length > 0) {
          lines.push("", "Новые объявления:");
          for (const { id, path } of newListings) {
            lines.push(`- https://re.kufar.by${path}`);
          }
          lines.push("", "Уведомления отправлены в Telegram (если заданы секреты).");
        }
        return new Response(lines.join("\n") + "\n", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`Ошибка: ${err.message}\n`, {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    // Diagnostic endpoint: fetch the raw Kufar HTML and return a slice of it,
    // so we can inspect the real response without needing account access to
    // Cloudflare logs. Paginate with ?offset=&length= (length capped at 20000).
    if (url.pathname === "/debug-html") {
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
      const length = Math.min(
        20000,
        Math.max(1, parseInt(url.searchParams.get("length") || "4000", 10) || 4000)
      );
      const searchUrl = env.SEARCH_URL || DEFAULT_SEARCH_URL;
      try {
        const html = await fetchSearchPage(searchUrl);
        const viOccurrences = (html.match(/\/vi\//g) || []).length;
        const listings = extractListings(html);
        const header = [
          `html length: ${html.length}`,
          `occurrences of "/vi/": ${viOccurrences}`,
          `listings matched by current regex: ${listings.size}`,
          `showing chars [${offset}, ${offset + length})`,
          "",
        ].join("\n");
        return new Response(header + html.slice(offset, offset + length), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`Ошибка запроса к Kufar: ${err.message}\n`, {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    return new Response(
      "Not found. Use GET / (or /check) for a manual run, /debug-html for diagnostics.\n",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  },
};
