import type { Subscriber } from "./subscribers";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface ReplyKeyboard {
  keyboard: string[][];
  resize_keyboard: true;
}

export const FILTERS_BUTTON = "🔍 Фильтры";
export const CLEAR_FILTERS_BUTTON = "♻️ Сбросить фильтры";

// Room counts of 4+ are a single bucket (see filters.ts::roomBucket) — the
// button list mirrors that, so "4+" is one toggle, not four.
export const ROOM_BUCKETS = [1, 2, 3, 4] as const;

export function roomLabel(n: number): string {
  return n === 4 ? "4+" : String(n);
}

export interface PriceBucket {
  key: string;
  label: string;
  min?: number;
  max?: number;
}

export const PRICE_BUCKETS: PriceBucket[] = [
  { key: "0-200", label: "до 200$", max: 200 },
  { key: "200-400", label: "200–400$", min: 200, max: 400 },
  { key: "400-600", label: "400–600$", min: 400, max: 600 },
  { key: "600-plus", label: "600$+", min: 600 },
  { key: "any", label: "Любая цена" },
];

export function findPriceBucketByKey(key: string): PriceBucket | undefined {
  return PRICE_BUCKETS.find((b) => b.key === key);
}

function selectedPriceBucketKey(subscriber: Subscriber): string | undefined {
  return PRICE_BUCKETS.find((b) => b.min === subscriber.minPrice && b.max === subscriber.maxPrice)?.key;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export function describeFilters(s: Subscriber): string {
  const parts: string[] = [];
  if (s.minPrice != null || s.maxPrice != null) {
    parts.push(`Цена: ${s.minPrice ?? "любая"}–${s.maxPrice ?? "любая"} $`);
  }
  if (s.rooms != null && s.rooms.length > 0) {
    parts.push(`Комнат: ${s.rooms.map(roomLabel).join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : "Фильтров нет — приходят все объявления.";
}

export function filtersMessageText(s: Subscriber): string {
  return `Фильтры:\n\n${describeFilters(s)}`;
}

export function buildFiltersKeyboard(subscriber: Subscriber): InlineKeyboard {
  const selectedRooms = new Set(subscriber.rooms ?? []);
  const roomsRow: InlineButton[] = ROOM_BUCKETS.map((n) => ({
    text: `${selectedRooms.has(n) ? "✅ " : ""}${roomLabel(n)} комн.`,
    callback_data: `room:${n}`,
  }));

  const selectedPriceKey = selectedPriceBucketKey(subscriber);
  const priceButtons: InlineButton[] = PRICE_BUCKETS.map((b) => ({
    text: `${selectedPriceKey === b.key ? "✅ " : ""}${b.label}`,
    callback_data: `price:${b.key}`,
  }));

  return {
    inline_keyboard: [roomsRow, ...chunk(priceButtons, 2), [{ text: "♻️ Сбросить всё", callback_data: "reset" }]],
  };
}

export function mainMenuKeyboard(): ReplyKeyboard {
  return {
    keyboard: [[FILTERS_BUTTON], [CLEAR_FILTERS_BUTTON]],
    resize_keyboard: true,
  };
}
