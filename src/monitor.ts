import type { Env } from "./env";
import type { AdDetails } from "./hotness";
import { formatAdMessage } from "./hotness";
import { fetchSearchHtml } from "./fetcher";
import { broadcastTelegramListing } from "./telegram";
import {
  getSeenIds,
  saveSeenIds,
  saveLastRunStatus,
  seenIdsKey,
  type FeedRunStatus,
} from "./state";
import { getSubscribers, subscriberCityId } from "./subscribers";
import { matchesFilter } from "./filters";
import { getCity, type CityId } from "./cities";
import { getFeedsForCity, SOURCE_PRESENTATION, type FeedDefinition } from "./sources";
import { fetchBynPerUsd } from "./rates";

const DEFAULT_MAX_SEEN_IDS = 800;

interface LoadedFeed {
  definition: FeedDefinition;
  status: number;
  htmlLength: number;
  adsById: Map<string, AdDetails>;
  error?: string;
}

export interface FeedResult extends FeedRunStatus {
  htmlLength: number;
}

export interface MonitorResult {
  status: number;
  htmlLength: number;
  foundIds: string[];
  newIds: string[];
  adsById: Map<string, AdDetails>;
  firstRun: boolean;
  htmlSample: string | null;
  telegramErrors: string[];
  blocked: boolean;
  subscriberCount: number;
  feeds: FeedResult[];
}

function compoundId(feed: FeedDefinition, id: string): string {
  return `${feed.source}:${feed.cityId}:${id}`;
}

async function loadFeed(
  definition: FeedDefinition,
  bynPerUsdPromise: Promise<number | null>
): Promise<LoadedFeed> {
  try {
    const { status, html } = await fetchSearchHtml(definition.url);
    if (status !== 200) {
      return {
        definition,
        status,
        htmlLength: html.length,
        adsById: new Map(),
        error: `HTTP ${status}`,
      };
    }

    const bynPerUsd = definition.source === "moya" ? await bynPerUsdPromise : null;
    const adsById = definition.extract(html, bynPerUsd);
    return {
      definition,
      status,
      htmlLength: html.length,
      adsById,
      error: adsById.size === 0 ? "Разметка получена, но объявления не распознаны" : undefined,
    };
  } catch (error) {
    return {
      definition,
      status: 0,
      htmlLength: 0,
      adsById: new Map(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runMonitor(env: Env): Promise<MonitorResult> {
  const maxSeenIds = Number(env.MAX_SEEN_IDS) || DEFAULT_MAX_SEEN_IDS;
  const subscribers = (await getSubscribers(env.KUFAR_KV)).filter((subscriber) => subscriber.active !== false);
  const cityIds = [
    ...new Set(subscribers.map((subscriber) => subscriberCityId(subscriber))),
  ] as CityId[];
  const definitions = cityIds.flatMap(getFeedsForCity);
  const needsMoyaRate = definitions.some((definition) => definition.source === "moya");
  const bynPerUsdPromise = needsMoyaRate ? fetchBynPerUsd() : Promise.resolve(null);

  // Fetch independent public feeds in parallel, then process notifications
  // sequentially so one subscriber does not receive concurrent bot requests.
  const loadedFeeds = await Promise.all(
    definitions.map((definition) => loadFeed(definition, bynPerUsdPromise))
  );

  const foundIds: string[] = [];
  const newIds: string[] = [];
  const adsById = new Map<string, AdDetails>();
  const telegramErrors: string[] = [];
  const feedResults: FeedResult[] = [];

  for (const loaded of loadedFeeds) {
    const { definition } = loaded;
    const parseFailed = loaded.status === 200 && loaded.adsById.size === 0;
    if (loaded.status !== 200 || parseFailed) {
      feedResults.push({
        source: definition.source,
        cityId: definition.cityId,
        status: loaded.status,
        htmlLength: loaded.htmlLength,
        foundCount: 0,
        newCount: 0,
        firstRun: false,
        blocked: true,
        error: loaded.error,
      });
      continue;
    }

    const feedFoundIds = [...loaded.adsById.keys()];
    const key = seenIdsKey(definition.source, definition.cityId);
    let seenIds = await getSeenIds(env.KUFAR_KV, key);
    let migratedLegacyKufar = false;

    // Preserve the existing Kufar/Gomel history from the old global key so
    // deploying this release cannot resend hundreds of advertisements.
    if (seenIds === null && definition.source === "kufar" && definition.cityId === "gomel") {
      const legacy = await getSeenIds(env.KUFAR_KV);
      if (legacy !== null) {
        seenIds = legacy;
        migratedLegacyKufar = true;
      }
    }

    const firstRun = seenIds === null;
    const seenSet = new Set(seenIds ?? []);
    const feedNewIds = firstRun ? [] : feedFoundIds.filter((id) => !seenSet.has(id));
    const citySubscribers = subscribers.filter(
      (subscriber) => subscriberCityId(subscriber) === definition.cityId
    );

    for (const id of feedFoundIds) {
      const ad = loaded.adsById.get(id);
      if (!ad) continue;
      const combined = compoundId(definition, id);
      foundIds.push(combined);
      adsById.set(combined, ad);
    }

    for (const id of feedNewIds) {
      const ad = loaded.adsById.get(id);
      if (!ad) continue;
      const combined = compoundId(definition, id);
      newIds.push(combined);
      const recipients = citySubscribers
        .filter((subscriber) => matchesFilter(ad, subscriber))
        .map((subscriber) => subscriber.chatId);
      const errors = await broadcastTelegramListing(env, recipients, ad);
      telegramErrors.push(...errors.map((error) => `${combined}: ${error}`));
    }

    if (firstRun || migratedLegacyKufar || feedNewIds.length > 0) {
      const updatedSeen = firstRun
        ? feedFoundIds
        : [...new Set([...(seenIds ?? []), ...feedNewIds])];
      await saveSeenIds(env.KUFAR_KV, updatedSeen, maxSeenIds, key);
    }

    feedResults.push({
      source: definition.source,
      cityId: definition.cityId,
      status: loaded.status,
      htmlLength: loaded.htmlLength,
      foundCount: feedFoundIds.length,
      newCount: feedNewIds.length,
      firstRun,
      blocked: false,
    });
  }

  const failedFeeds = feedResults.filter((feed) => feed.blocked);
  const status = failedFeeds[0]?.status || 200;
  const blocked = definitions.length > 0 && failedFeeds.length === definitions.length;
  const firstRun = feedResults.some((feed) => feed.firstRun);
  const htmlLength = feedResults.reduce((total, feed) => total + feed.htmlLength, 0);

  await saveLastRunStatus(env.KUFAR_KV, {
    ranAt: new Date().toISOString(),
    status,
    foundCount: foundIds.length,
    newCount: newIds.length,
    firstRun,
    blocked,
    telegramErrorCount: telegramErrors.length,
    subscriberCount: subscribers.length,
    feeds: feedResults,
  });

  return {
    status,
    htmlLength,
    foundIds,
    newIds,
    adsById,
    firstRun,
    htmlSample: null,
    telegramErrors,
    blocked,
    subscriberCount: subscribers.length,
    feeds: feedResults,
  };
}

export function formatReport(result: MonitorResult): string {
  const lines: string[] = ["Монитор объявлений — прогон"];
  lines.push(`Подписчиков: ${result.subscriberCount}`);

  if (result.feeds.length === 0) {
    lines.push("Нет активных городов: сначала кто-нибудь должен подписаться через /start.");
  }

  for (const feed of result.feeds) {
    const source = SOURCE_PRESENTATION[feed.source];
    const city = getCity(feed.cityId).name;
    const status = feed.blocked
      ? `ошибка: ${feed.error ?? `HTTP ${feed.status}`}`
      : `найдено ${feed.foundCount}, новых ${feed.newCount}`;
    lines.push(
      `${source.icon} ${source.label} · ${city}: ${status}${feed.firstRun ? " (создана базовая точка)" : ""}`
    );
  }

  lines.push(`Всего найдено: ${result.foundIds.length}`);
  lines.push(`Всего новых: ${result.newIds.length}`);

  if (result.newIds.length > 0) {
    const details = result.newIds.map((id) => {
      const ad = result.adsById.get(id);
      const headline = ad ? formatAdMessage(ad).split("\n")[0].replace(/<[^>]+>/g, "") : null;
      return headline ? `${id} — ${headline}` : id;
    });
    lines.push(`Новые:\n${details.join("\n")}`);
  }

  if (result.telegramErrors.length > 0) {
    lines.push("Ошибки отправки в Telegram:");
    lines.push(...result.telegramErrors);
  }

  return lines.join("\n");
}
