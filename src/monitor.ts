import type { Env } from "./env";
import type { AdDetails } from "./hotness";
import { formatAdMessage } from "./hotness";
import { fetchSearchHtml } from "./fetcher";
import { extractAds } from "./kufar";
import { broadcastTelegramMessage } from "./telegram";
import { getSeenIds, saveSeenIds, saveLastRunStatus } from "./state";
import { getSubscribers } from "./subscribers";
import { matchesFilter } from "./filters";

const DEFAULT_MAX_SEEN_IDS = 800;

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
}

export async function runMonitor(env: Env): Promise<MonitorResult> {
  const maxSeenIds = Number(env.MAX_SEEN_IDS) || DEFAULT_MAX_SEEN_IDS;
  const subscribers = await getSubscribers(env.KUFAR_KV);
  const { status, html } = await fetchSearchHtml(env.SEARCH_URL);

  if (status !== 200) {
    await saveLastRunStatus(env.KUFAR_KV, {
      ranAt: new Date().toISOString(),
      status,
      foundCount: 0,
      newCount: 0,
      firstRun: false,
      blocked: true,
      telegramErrorCount: 0,
      subscriberCount: subscribers.length,
    });
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
      subscriberCount: subscribers.length,
    };
  }

  const adsById = extractAds(html);
  const foundIds = [...adsById.keys()];

  const seenIds = await getSeenIds(env.KUFAR_KV);
  const firstRun = seenIds === null;
  const seenSet = new Set(seenIds ?? []);
  const newIds = firstRun ? [] : foundIds.filter((id) => !seenSet.has(id));

  const telegramErrors: string[] = [];
  for (const id of newIds) {
    const ad = adsById.get(id);
    if (!ad) continue;
    const recipients = subscribers.filter((s) => matchesFilter(ad, s)).map((s) => s.chatId);
    const errors = await broadcastTelegramMessage(env, recipients, formatAdMessage(ad));
    telegramErrors.push(...errors.map((e) => `${id}: ${e}`));
  }

  // Only write seen_ids when the set actually changes — keeps well within
  // the free-tier daily write quota even at a tight poll interval.
  if (firstRun || newIds.length > 0) {
    const updatedSeen = firstRun ? foundIds : [...(seenIds ?? []), ...newIds];
    await saveSeenIds(env.KUFAR_KV, updatedSeen, maxSeenIds);
  }

  await saveLastRunStatus(env.KUFAR_KV, {
    ranAt: new Date().toISOString(),
    status,
    foundCount: foundIds.length,
    newCount: newIds.length,
    firstRun,
    blocked: false,
    telegramErrorCount: telegramErrors.length,
    subscriberCount: subscribers.length,
  });

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
    subscriberCount: subscribers.length,
  };
}

export function formatReport(result: MonitorResult): string {
  const lines: string[] = [];
  lines.push("Kufar monitor — прогон");
  lines.push(`HTTP статус: ${result.status}`);
  lines.push(`Размер HTML: ${result.htmlLength} байт`);

  if (result.blocked) {
    lines.push("");
    lines.push("Запрос к Kufar не вернул 200 — возможна блокировка/редирект.");
    lines.push("Фрагмент ответа (первые 2000 символов):");
    lines.push(result.htmlSample ?? "");
    return lines.join("\n");
  }

  lines.push(`Найдено объявлений: ${result.foundIds.length}`);
  lines.push(`Подписчиков: ${result.subscriberCount}${result.subscriberCount === 0 ? " (никто не жал /start у бота)" : ""}`);

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
    lines.push(result.htmlSample ?? "");
  }

  if (result.telegramErrors.length > 0) {
    lines.push("");
    lines.push("Ошибки отправки в Telegram:");
    lines.push(...result.telegramErrors);
  }

  return lines.join("\n");
}
