import type { Env } from "./env";
import { addSubscriber, getSubscriber, updateSubscriber } from "./subscribers";
import { sendTelegramMessage, answerCallbackQuery, editMessageText } from "./telegram";
import {
  buildFiltersKeyboard,
  describeFilters,
  filtersMessageText,
  findPriceBucketByKey,
  mainMenuKeyboard,
  FILTERS_BUTTON,
  CLEAR_FILTERS_BUTTON,
} from "./filter-ui";

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat?: { id?: number | string };
      message_id?: number;
    };
  };
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

// "/rooms 1,2,3" or "/rooms 2" → sorted unique list (4+ collapses to 4, same
// bucket the filter buttons use); "/rooms off" clears it.
function parseRoomsCommand(text: string): number[] | "off" | null {
  const args = text.replace(/^\/rooms(@\S+)?\s*/i, "").trim();
  if (args === "") return null;
  if (/^off$/i.test(args)) return "off";
  const parts = args.split(/[,\s]+/).map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  const bucketed = parts.map((n) => (n >= 4 ? 4 : n));
  return [...new Set(bucketed)].sort((a, b) => a - b);
}

interface CommandReply {
  text: string;
  markup?: unknown;
}

async function handleCommand(env: Env, chatId: string, text: string): Promise<CommandReply> {
  if (text.startsWith("/start")) {
    const isNew = await addSubscriber(env.KUFAR_KV, chatId);
    return {
      text: isNew
        ? "Подписка оформлена — сюда будут приходить новые объявления с Kufar.\n\n" +
          "Настроить фильтры можно кнопкой «🔍 Фильтры» внизу, либо командами /price и /rooms."
        : "Вы уже подписаны. Кнопка «🔍 Фильтры» внизу — посмотреть/изменить фильтры.",
      markup: mainMenuKeyboard(),
    };
  }

  if (text.startsWith(FILTERS_BUTTON) || text.startsWith("/filters")) {
    const s = await getSubscriber(env.KUFAR_KV, chatId);
    if (!s) return { text: "Вы ещё не подписаны — нажмите /start.", markup: mainMenuKeyboard() };
    return { text: filtersMessageText(s), markup: buildFiltersKeyboard(s) };
  }

  if (text.startsWith(CLEAR_FILTERS_BUTTON) || text.startsWith("/clearfilters")) {
    const existing = await getSubscriber(env.KUFAR_KV, chatId);
    if (!existing) return { text: "Вы ещё не подписаны — нажмите /start.", markup: mainMenuKeyboard() };
    const s = await updateSubscriber(env.KUFAR_KV, chatId, {
      minPrice: undefined,
      maxPrice: undefined,
      rooms: undefined,
    });
    return { text: `Все фильтры сброшены.\n\n${describeFilters(s)}`, markup: buildFiltersKeyboard(s) };
  }

  if (text.startsWith("/price")) {
    const parsed = parsePriceCommand(text);
    if (parsed === null) {
      return {
        text: "Формат: /price 100-300 (в $), либо /price off, чтобы снять фильтр по цене.",
        markup: mainMenuKeyboard(),
      };
    }
    const s =
      parsed === "off"
        ? await updateSubscriber(env.KUFAR_KV, chatId, { minPrice: undefined, maxPrice: undefined })
        : await updateSubscriber(env.KUFAR_KV, chatId, { minPrice: parsed.min, maxPrice: parsed.max });
    return { text: `Фильтр по цене сохранён.\n\n${describeFilters(s)}`, markup: buildFiltersKeyboard(s) };
  }

  if (text.startsWith("/rooms")) {
    const parsed = parseRoomsCommand(text);
    if (parsed === null) {
      return {
        text: "Формат: /rooms 1,2,3 (через запятую; 4 значит «4 и больше»), либо /rooms off.",
        markup: mainMenuKeyboard(),
      };
    }
    const s =
      parsed === "off"
        ? await updateSubscriber(env.KUFAR_KV, chatId, { rooms: undefined })
        : await updateSubscriber(env.KUFAR_KV, chatId, { rooms: parsed });
    return { text: `Фильтр по комнатам сохранён.\n\n${describeFilters(s)}`, markup: buildFiltersKeyboard(s) };
  }

  return {
    text: "Команды: /start, /price 100-300, /rooms 1,2, /filters, /clearfilters — или кнопки внизу.",
    markup: mainMenuKeyboard(),
  };
}

async function handleCallbackQuery(
  env: Env,
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>
): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;

  if (chatId == null || messageId == null || !data) {
    await answerCallbackQuery(env, callbackQuery.id);
    return;
  }
  const chatIdStr = String(chatId);

  if (data === "reset") {
    await updateSubscriber(env.KUFAR_KV, chatIdStr, { minPrice: undefined, maxPrice: undefined, rooms: undefined });
  } else if (data.startsWith("room:")) {
    const n = Number(data.slice("room:".length));
    const current = (await getSubscriber(env.KUFAR_KV, chatIdStr))?.rooms ?? [];
    const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n].sort((a, b) => a - b);
    await updateSubscriber(env.KUFAR_KV, chatIdStr, { rooms: next.length > 0 ? next : undefined });
  } else if (data.startsWith("price:")) {
    const bucket = findPriceBucketByKey(data.slice("price:".length));
    if (bucket) {
      await updateSubscriber(env.KUFAR_KV, chatIdStr, { minPrice: bucket.min, maxPrice: bucket.max });
    }
  }

  const updated = (await getSubscriber(env.KUFAR_KV, chatIdStr)) ?? { chatId: chatIdStr };
  await answerCallbackQuery(env, callbackQuery.id);
  try {
    await editMessageText(env, chatIdStr, messageId, filtersMessageText(updated), buildFiltersKeyboard(updated));
  } catch {
    // Filter state is already saved; a failed panel refresh isn't worth
    // failing the webhook response over.
  }
}

// Handles Telegram's webhook POST — the only place that turns incoming
// commands, menu-button taps, and inline-keyboard button taps into stored
// subscription/filter state. Always replies 200 so Telegram doesn't treat
// this as a delivery failure and keep retrying the same update.
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("ok");
  }

  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
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
    await sendTelegramMessage(env, chatIdStr, reply.text, reply.markup);
  } catch {
    // Subscription/filter state is already saved; a failed confirmation
    // isn't worth failing the webhook response over.
  }

  return new Response("ok");
}
