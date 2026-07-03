const DEFAULT_MAX_SEEN_IDS = 800;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7";

// Matches ad links like:
//   /vi/gomel/snyat/kvartiru/123456
//   /vi/gomel/snyat/kvartiru/v-novostrojke/123456
// Used only as a fallback if __NEXT_DATA__ isn't present/parseable.
const AD_LINK_RE = /(\/vi\/(?:[a-z0-9-]+\/){3,4}(\d{5,}))(?![a-z0-9-])/gi;

// Rough Gomel city-center reference point, used only to rank listings by
// proximity for the hotness score below. Approximate — verify/adjust via
// Google/Yandex Maps if it doesn't match your idea of "center".
const CITY_CENTER = { lat: 52.4245, lng: 31.0017 };

// Hotness thresholds — deliberately simple and tunable. "Price per room"
// is used instead of raw price so a cheap-but-tiny studio doesn't
// automatically outrank a slightly pricier multi-room flat.
const PRICE_PER_ROOM_GREAT_USD = 120;
const PRICE_PER_ROOM_OK_USD = 200;
const CENTER_CLOSE_KM = 2;
const CENTER_OK_KM = 5;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Depth-first search for the first array of ad-like objects ({ ad_id, ... })
// anywhere in the Next.js hydration payload. Avoids hardcoding the exact
// nested path (props.pageProps....), which is more likely to shift on a
// Kufar redesign than the shape of an individual ad object.
function findAdsArray(node, depth = 0) {
  if (depth > 15 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every((el) => el && typeof el === "object" && "ad_id" in el)
    ) {
      return node;
    }
    for (const item of node) {
      const found = findAdsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(node)) {
    const found = findAdsArray(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function getParamValue(params, key) {
  if (!Array.isArray(params)) return null;
  const found = params.find((p) => p && p.p === key);
  return found ? found.v : null;
}

function buildAdDetails(ad) {
  const id = String(ad.ad_id);

  const roomsRaw = getParamValue(ad.ad_parameters, "rooms");
  const roomsNum = roomsRaw != null ? Number(roomsRaw) : null;
  const rooms = Number.isFinite(roomsNum) ? roomsNum : null;

  const coords = getParamValue(ad.ad_parameters, "coordinates"); // [lng, lat]
  const address = getParamValue(ad.account_parameters, "address");

  let priceUsd = null;
  if (Array.isArray(ad.calculator)) {
    const usd = ad.calculator.find((c) => c.currency === "USD");
    if (usd && usd.price != null) priceUsd = Number(usd.price) / 100;
  }

  let distanceKm = null;
  if (Array.isArray(coords) && coords.length === 2) {
    distanceKm = haversineKm(CITY_CENTER.lat, CITY_CENTER.lng, coords[1], coords[0]);
  }

  return {
    id,
    link: ad.ad_link || `https://re.kufar.by/vi/${id}`,
    priceUsd,
    rooms,
    address: address || null,
    distanceKm,
  };
}

function extractAdsFromNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const adsArray = findAdsArray(parsed);
  if (!adsArray) return null;

  const byId = new Map();
  for (const ad of adsArray) {
    if (ad && ad.ad_id != null) {
      const details = buildAdDetails(ad);
      if (!byId.has(details.id)) byId.set(details.id, details);
    }
  }
  return byId;
}

function extractAds(html) {
  const rich = extractAdsFromNextData(html);
  if (rich && rich.size > 0) return rich;

  // Fallback: id/link only, no price/rooms/address/distance.
  const unescaped = html.replace(/\\\//g, "/");
  const byId = new Map();
  for (const match of unescaped.matchAll(AD_LINK_RE)) {
    const [, path, id] = match;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        link: `https://re.kufar.by${path}`,
        priceUsd: null,
        rooms: null,
        address: null,
        distanceKm: null,
      });
    }
  }
  return byId;
}

// Standalone debug helper: shows what real ad data looks like inside
// __NEXT_DATA__ so extraction logic can be extended without guessing
// blind. Does not touch KV or Telegram.
function extractDebugInfo(html) {
  const unescaped = html.replace(/\\\//g, "/");

  const nextDataMatch = unescaped.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );
  const nextData = nextDataMatch ? nextDataMatch[1] : null;

  const idRegex = new RegExp(AD_LINK_RE.source, AD_LINK_RE.flags);
  const firstAdMatch = idRegex.exec(unescaped);
  const firstAdId = firstAdMatch ? firstAdMatch[2] : null;

  let adJsonSnippet = null;
  if (nextData && firstAdId) {
    const idPos = nextData.indexOf(firstAdId);
    if (idPos !== -1) {
      const start = Math.max(0, idPos - 300);
      const end = Math.min(nextData.length, idPos + 3500);
      adJsonSnippet = nextData.slice(start, end);
    }
  }

  return {
    hasNextData: !!nextData,
    nextDataLength: nextData ? nextData.length : 0,
    firstAdId,
    adJsonSnippet,
  };
}

function formatDebugReport(debug) {
  const lines = [];
  lines.push("Kufar monitor — debug (без записи в KV и без Telegram)");
  lines.push(`__NEXT_DATA__ найден: ${debug.hasNextData ? "да" : "нет"}`);
  if (debug.hasNextData) {
    lines.push(`Размер __NEXT_DATA__: ${debug.nextDataLength} байт`);
  }
  lines.push(`Первый найденный id объявления: ${debug.firstAdId ?? "не найден"}`);
  lines.push("");
  lines.push("Кусок __NEXT_DATA__ вокруг этого id (±300/3500 символов):");
  lines.push(debug.adJsonSnippet ?? "(не найдено — id не встречается в __NEXT_DATA__ как есть)");
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
    // Kufar is itself behind Cloudflare — without this, cron polls could
    // be served a cached copy of the search page instead of the freshest
    // one, adding extra delay on top of the polling interval.
    cf: { cacheTtl: 0, cacheEverything: false },
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

function classifyHotness(ad) {
  let score = 0;
  let maxScore = 0;

  if (ad.priceUsd != null && ad.rooms != null) {
    const effectiveRooms = ad.rooms > 0 ? ad.rooms : 1;
    const pricePerRoom = ad.priceUsd / effectiveRooms;
    maxScore += 2;
    if (pricePerRoom <= PRICE_PER_ROOM_GREAT_USD) score += 2;
    else if (pricePerRoom <= PRICE_PER_ROOM_OK_USD) score += 1;
  }

  if (ad.distanceKm != null) {
    maxScore += 2;
    if (ad.distanceKm <= CENTER_CLOSE_KM) score += 2;
    else if (ad.distanceKm <= CENTER_OK_KM) score += 1;
  }

  if (maxScore === 0) return "⚪";
  const ratio = score / maxScore;
  if (ratio >= 0.75) return "🟢";
  if (ratio >= 0.25) return "🟡";
  return "🔴";
}

function formatAdMessage(ad) {
  const circle = classifyHotness(ad);
  const parts = [];
  if (ad.priceUsd != null) parts.push(`${ad.priceUsd.toFixed(0)}$`);
  if (ad.rooms != null) parts.push(`${ad.rooms} комн.`);
  if (ad.distanceKm != null) parts.push(`${ad.distanceKm.toFixed(1)} км до центра`);

  const lines = [`${circle} ${parts.join(", ") || "Новое объявление"}`];
  if (ad.address) lines.push(ad.address);
  lines.push(ad.link);
  return lines.join("\n");
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
      adsById: new Map(),
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
    const ad = adsById.get(id);
    try {
      await sendTelegramMessage(env, formatAdMessage(ad));
    } catch (err) {
      telegramErrors.push(`${id}: ${err.message}`);
    }
  }

  // Only write to KV when the seen set actually changes — keeps well
  // within the free-tier daily write quota even at a tight poll interval.
  if (firstRun || newIds.length > 0) {
    const updatedSeen = firstRun ? foundIds : [...seenIds, ...newIds];
    await saveSeenIds(env.KUFAR_KV, updatedSeen, maxSeenIds);
  }

  return {
    status,
    htmlLength: html.length,
    foundIds,
    newIds,
    adsById,
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
      const details = result.newIds.map((id) => {
        const ad = result.adsById.get(id);
        return ad ? `${id} — ${formatAdMessage(ad).split("\n")[0]}` : id;
      });
      lines.push(`Новые:\n${details.join("\n")}`);
    }
  }

  if (result.foundIds.length > 0) {
    lines.push(`Пример найденных id: ${result.foundIds.slice(0, 10).join(", ")}`);
  } else {
    lines.push("");
    lines.push("Id не найдены — разметка/JSON не сматчились. Фрагмент HTML:");
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

    // Self-service test helper: drops the last N ids from seen_ids so the
    // next cron tick (or a manual reload of the plain URL) treats them as
    // "new" again and sends real Telegram notifications for them — lets
    // you test the full pipeline without asking anyone to edit KV by hand.
    const resetLastParam = url.searchParams.get("resetLast");
    if (resetLastParam !== null) {
      const n = Math.max(1, Number(resetLastParam) || 5);
      const seenIds = (await getSeenIds(env.KUFAR_KV)) ?? [];
      const removed = seenIds.slice(-n);
      const remaining = seenIds.slice(0, Math.max(0, seenIds.length - n));
      await env.KUFAR_KV.put("seen_ids", JSON.stringify(remaining));
      const lines = [
        `Удалено из seen_ids: ${removed.length}`,
        removed.join(", ") || "(база была пуста)",
        "",
        `Осталось в базе: ${remaining.length}`,
        "Дальше ничего нажимать не нужно — на ближайшем крон-тике (раз в 3 минуты)",
        "эти id снова будут найдены на сайте и уйдут как «новые» уведомления в Telegram.",
        "Если хочешь проверить сразу, не дожидаясь крона — открой обычную ссылку (без параметров).",
      ];
      return new Response(lines.join("\n"), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

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
