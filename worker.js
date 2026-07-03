const DEFAULT_MAX_SEEN_IDS = 800;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7";

// Matches ad links like:
//   /vi/gomel/snyat/kvartiru/123456
//   /vi/gomel/snyat/kvartiru/v-novostrojke/123456
// Generic across region/category so it keeps working if SEARCH_URL is
// pointed at a different city or listing type.
const AD_LINK_RE = /(\/vi\/(?:[a-z0-9-]+\/){3,4}(\d{5,}))(?![a-z0-9-])/gi;

function extractAds(html) {
  // Next.js SSR payloads sometimes JSON-escape slashes ("\/vi\/...").
  const unescaped = html.replace(/\\\//g, "/");
  const byId = new Map();
  for (const match of unescaped.matchAll(AD_LINK_RE)) {
    const [, path, id] = match;
    if (!byId.has(id)) byId.set(id, path);
  }
  return byId; // id -> path
}

// Standalone debug helper: shows what real ad markup looks like (price,
// rooms, address) so extractAds/formatting logic can be extended to parse
// them without guessing blind. Does not touch KV or Telegram.
function extractDebugInfo(html) {
  const unescaped = html.replace(/\\\//g, "/");

  const nextDataMatch = unescaped.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );

  const idRegex = new RegExp(AD_LINK_RE.source, AD_LINK_RE.flags);
  const firstAdMatch = idRegex.exec(unescaped);

  let cardSnippet = null;
  if (firstAdMatch) {
    const start = Math.max(0, firstAdMatch.index - 1500);
    const end = Math.min(unescaped.length, firstAdMatch.index + 1500);
    cardSnippet = unescaped.slice(start, end);
  }

  return {
    hasNextData: !!nextDataMatch,
    nextDataLength: nextDataMatch ? nextDataMatch[1].length : 0,
    nextDataSample: nextDataMatch ? nextDataMatch[1].slice(0, 4000) : null,
    cardSnippet,
  };
}

function formatDebugReport(debug) {
  const lines = [];
  lines.push("Kufar monitor — debug (без записи в KV и без Telegram)");
  lines.push(`__NEXT_DATA__ найден: ${debug.hasNextData ? "да" : "нет"}`);
  if (debug.hasNextData) {
    lines.push(`Размер __NEXT_DATA__: ${debug.nextDataLength} байт`);
    lines.push("Первые 4000 символов __NEXT_DATA__:");
    lines.push(debug.nextDataSample);
  }
  lines.push("");
  lines.push(
    "Фрагмент HTML вокруг первой найденной ссылки на объявление (±1500 символов):"
  );
  lines.push(debug.cardSnippet ?? "(ссылка не найдена)");
  return lines.join("\n");
}

async function fetchSearchHtml(searchUrl) {
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": ACCEPT_LANGUAGE,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });
  const html = await res.text();
  return { status: res.status, html };
}

async function getSeenIds(kv) {
  const raw = await kv.get("seen_ids");
  if (raw === null) return null; // never run before
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSeenIds(kv, ids, maxSeenIds) {
  const trimmed = ids.slice(-maxSeenIds);
  await kv.put("seen_ids", JSON.stringify(trimmed));
}

async function sendTelegramMessage(env, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

async function runMonitor(env) {
  const maxSeenIds = Number(env.MAX_SEEN_IDS) || DEFAULT_MAX_SEEN_IDS;
  const { status, html } = await fetchSearchHtml(env.SEARCH_URL);

  if (status !== 200) {
    return {
      status,
      htmlLength: html.length,
      foundIds: [],
      newIds: [],
      firstRun: false,
      htmlSample: html.slice(0, 2000),
      telegramErrors: [],
      blocked: true,
    };
  }

  const adsById = extractAds(html);
  const foundIds = [...adsById.keys()];

  const seenIds = await getSeenIds(env.KUFAR_KV);
  const firstRun = seenIds === null;
  const seenSet = new Set(seenIds ?? []);
  const newIds = firstRun ? [] : foundIds.filter((id) => !seenSet.has(id));

  const telegramErrors = [];
  for (const id of newIds) {
    const link = `https://re.kufar.by${adsById.get(id)}`;
    try {
      await sendTelegramMessage(env, `Новое объявление: ${link}`);
    } catch (err) {
      telegramErrors.push(`${id}: ${err.message}`);
    }
  }

  const updatedSeen = [...(seenIds ?? []), ...foundIds.filter((id) => !seenSet.has(id))];
  await saveSeenIds(env.KUFAR_KV, updatedSeen, maxSeenIds);

  return {
    status,
    htmlLength: html.length,
    foundIds,
    newIds,
    firstRun,
    htmlSample: foundIds.length === 0 ? html.slice(0, 2000) : null,
    telegramErrors,
    blocked: false,
  };
}

function formatReport(result) {
  const lines = [];
  lines.push("Kufar monitor — тестовый запуск");
  lines.push(`HTTP статус: ${result.status}`);
  lines.push(`Размер HTML: ${result.htmlLength} байт`);

  if (result.blocked) {
    lines.push("");
    lines.push("Запрос к Kufar не вернул 200 — возможна блокировка/редирект.");
    lines.push("Фрагмент ответа (первые 2000 символов):");
    lines.push(result.htmlSample);
    return lines.join("\n");
  }

  lines.push(`Найдено объявлений: ${result.foundIds.length}`);

  if (result.firstRun) {
    lines.push(
      "Первый запуск: база 'seen_ids' была пуста, поэтому все найденные id сохранены как базовые, уведомления НЕ отправлялись."
    );
  } else {
    lines.push(`Новых объявлений: ${result.newIds.length}`);
    if (result.newIds.length > 0) {
      lines.push(`Новые id: ${result.newIds.join(", ")}`);
    }
  }

  if (result.foundIds.length > 0) {
    lines.push(`Пример найденных id: ${result.foundIds.slice(0, 10).join(", ")}`);
  } else {
    lines.push("");
    lines.push("Id не найдены — регулярка не сматчила разметку. Фрагмент HTML:");
    lines.push(result.htmlSample);
  }

  if (result.telegramErrors.length > 0) {
    lines.push("");
    lines.push("Ошибки отправки в Telegram:");
    lines.push(...result.telegramErrors);
  }

  return lines.join("\n");
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("debug") === "1") {
      const { status, html } = await fetchSearchHtml(env.SEARCH_URL);
      if (status !== 200) {
        return new Response(
          `HTTP статус: ${status}\n\n${html.slice(0, 2000)}`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
      const debug = extractDebugInfo(html);
      return new Response(formatDebugReport(debug), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const result = await runMonitor(env);
    return new Response(formatReport(result), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
