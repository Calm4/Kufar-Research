import type { Env } from "./env";
import { fetchSearchHtml } from "./fetcher";
import { extractDebugInfo } from "./kufar";
import { formatDebugReport } from "./debug";
import { runMonitor, formatReport } from "./monitor";
import { getSeenIds, getLastRunStatus, isAuthorized } from "./state";

function unauthorized(): Response {
  return new Response("401 Unauthorized — missing or wrong ?token=\n", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!isAuthorized(env, url)) return unauthorized();

    // Read-only: last run's summary, so you can check "is this actually
    // running" without digging through Cloudflare Observability logs.
    if (url.pathname === "/status") {
      const lastRun = await getLastRunStatus(env.KUFAR_KV);
      if (!lastRun) return text("Ещё ни разу не запускалось.");
      const ageMs = Date.now() - new Date(lastRun.ranAt).getTime();
      const ageMin = (ageMs / 60000).toFixed(1);
      return text(
        [
          `Последний запуск: ${lastRun.ranAt} (${ageMin} мин назад)`,
          `HTTP статус: ${lastRun.status}${lastRun.blocked ? " (заблокировано)" : ""}`,
          `Найдено: ${lastRun.foundCount}, новых: ${lastRun.newCount}, firstRun: ${lastRun.firstRun}`,
          `Ошибок Telegram: ${lastRun.telegramErrorCount}`,
        ].join("\n")
      );
    }

    // Self-service test helper: drops the last N ids from seen_ids so the
    // next poll treats them as "new" again and sends real Telegram
    // notifications for them — lets you test the full pipeline without
    // waiting for a real new listing.
    const resetLastParam = url.searchParams.get("resetLast");
    if (resetLastParam !== null) {
      const n = Math.max(1, Number(resetLastParam) || 5);
      const seenIds = (await getSeenIds(env.KUFAR_KV)) ?? [];
      const removed = seenIds.slice(-n);
      const remaining = seenIds.slice(0, Math.max(0, seenIds.length - n));
      await env.KUFAR_KV.put("seen_ids", JSON.stringify(remaining));
      return text(
        [
          `Удалено из seen_ids: ${removed.length}`,
          removed.join(", ") || "(база была пуста)",
          "",
          `Осталось в базе: ${remaining.length}`,
          "Следующий poll (внешний cron, максимум несколько минут) снова",
          "найдёт эти id и пришлёт их в Telegram как «новые». Либо открой",
          "обычную ссылку (с ?token=..., без остальных параметров) вручную.",
        ].join("\n")
      );
    }

    if (url.searchParams.get("debug") === "1") {
      const { status, html } = await fetchSearchHtml(env.SEARCH_URL);
      if (status !== 200) {
        return text(`HTTP статус: ${status}\n\n${html.slice(0, 2000)}`);
      }
      return text(formatDebugReport(extractDebugInfo(html)));
    }

    const result = await runMonitor(env);
    return text(formatReport(result));
  },
};
