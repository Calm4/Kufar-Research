import type { Env } from "./env";
import { addSubscriber, getSubscriber, updateSubscriber, type Subscriber } from "./subscribers";
import { sendTelegramMessage } from "./telegram";

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

function describeFilters(s: Subscriber): string {
  const parts: string[] = [];
  if (s.minPrice != null || s.maxPrice != null) {
    parts.push(`Цена: ${s.minPrice ?? "любая"}–${s.maxPrice ?? "любая"} $`);
  }
  if (s.rooms != null && s.rooms.length > 0) {
    parts.push(`Комнат: ${s.rooms.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : "Фильтров нет — приходят все объявления.";
}

// "/price 100-300" or "/price 100 300" → {min, max}; "/price off" clears it.
function parsePriceCommand(text: string): { min: number; max: number } | "off" | null {
  const args = text.replace(/^\/price(@\S+)?\s*/i, "").trim();
  if (args === "") return null;
  if (/^off$/i.test(args)) return "off";
  const match = args.match(/^(\d+)\s*[-\s]\s*(\d+)$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (min > max) return null;
  return { min, max };
}

// "/rooms 1,2,3" or "/rooms 2" → sorted unique list; "/rooms off" clears it.
function parseRoomsCommand(text: string): number[] | "off" | null {
  const args = text.replace(/^\/rooms(@\S+)?\s*/i, "").trim();
  if (args === "") return null;
  if (/^off$/i.test(args)) return "off";
  const parts = args.split(/[,\s]+/).map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return [...new Set(parts)].sort((a, b) => a - b);
}

async function handleCommand(env: Env, chatId: string, text: string): Promise<string> {
  if (text.startsWith("/start")) {
    const isNew = await addSubscriber(env.KUFAR_KV, chatId);
    return isNew
      ? "Подписка оформлена — сюда будут приходить новые объявления с Kufar.\n\n" +
          "Фильтры (необязательно):\n" +
          "/price 100-300 — цена в $\n" +
          "/rooms 1,2 — количество комнат\n" +
          "/filters — посмотреть текущие фильтры\n" +
          "/clearfilters — сбросить все фильтры"
      : "Вы уже подписаны. /filters — посмотреть текущие фильтры.";
  }

  if (text.startsWith("/price")) {
    const parsed = parsePriceCommand(text);
    if (parsed === null) {
      return "Формат: /price 100-300 (в $), либо /price off, чтобы снять фильтр по цене.";
    }
    const s =
      parsed === "off"
        ? await updateSubscriber(env.KUFAR_KV, chatId, { minPrice: undefined, maxPrice: undefined })
        : await updateSubscriber(env.KUFAR_KV, chatId, { minPrice: parsed.min, maxPrice: parsed.max });
    return `Фильтр по цене сохранён.\n\n${describeFilters(s)}`;
  }

  if (text.startsWith("/rooms")) {
    const parsed = parseRoomsCommand(text);
    if (parsed === null) {
      return "Формат: /rooms 1,2,3 (через запятую), либо /rooms off, чтобы снять фильтр.";
    }
    const s =
      parsed === "off"
        ? await updateSubscriber(env.KUFAR_KV, chatId, { rooms: undefined })
        : await updateSubscriber(env.KUFAR_KV, chatId, { rooms: parsed });
    return `Фильтр по комнатам сохранён.\n\n${describeFilters(s)}`;
  }

  if (text.startsWith("/filters")) {
    const s = await getSubscriber(env.KUFAR_KV, chatId);
    return s ? describeFilters(s) : "Вы ещё не подписаны — нажмите /start.";
  }

  if (text.startsWith("/clearfilters")) {
    const existing = await getSubscriber(env.KUFAR_KV, chatId);
    if (!existing) return "Вы ещё не подписаны — нажмите /start.";
    const s = await updateSubscriber(env.KUFAR_KV, chatId, {
      minPrice: undefined,
      maxPrice: undefined,
      rooms: undefined,
    });
    return `Все фильтры сброшены.\n\n${describeFilters(s)}`;
  }

  return "Команды: /start, /price 100-300, /rooms 1,2, /filters, /clearfilters";
}

// Handles Telegram's webhook POST — the only place that turns incoming
// commands (/start, /price, /rooms, ...) into stored subscription state.
// Always replies 200 so Telegram doesn't treat this as a delivery failure
// and keep retrying the same update.
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("ok");
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (chatId === undefined || chatId === null || !text) {
    return new Response("ok");
  }

  const chatIdStr = String(chatId);
  const reply = await handleCommand(env, chatIdStr, text.trim());
  try {
    await sendTelegramMessage(env, chatIdStr, reply);
  } catch {
    // Subscription/filter state is already saved; a failed confirmation
    // isn't worth failing the webhook response over.
  }

  return new Response("ok");
}
