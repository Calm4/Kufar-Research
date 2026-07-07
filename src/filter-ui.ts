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
export const SUBSCRIBE_BUTTON = "🔔 Подписаться на уведомления";
export const UNSUBSCRIBE_BUTTON = "🔕 Отписаться от уведомлений";

// The menu's top button is one toggle, not two separate ones — its label
// (and what tapping it does) depends on whether the subscriber currently
// has notifications on.
export function isActiveSubscriber(subscriber: Subscriber | null): boolean {
  return subscriber != null && subscriber.active !== false;
}

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

// "Любая цена" isn't a real range — it just means "no price filter", so it
// reads as selected exactly when there's nothing else selected.
function isPriceBucketSelected(subscriber: Subscriber, bucket: PriceBucket): boolean {
  if (bucket.key === "any") {
    return !subscriber.priceRanges || subscriber.priceRanges.length === 0;
  }
  return (subscriber.priceRanges ?? []).some((r) => r.min === bucket.min && r.max === bucket.max);
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function formatPriceRange(range: { min?: number; max?: number }): string {
  const bucket = PRICE_BUCKETS.find((b) => b.key !== "any" && b.min === range.min && b.max === range.max);
  if (bucket) return bucket.label;
  if (range.min != null && range.max != null) return `${range.min}–${range.max} $`;
  if (range.min != null) return `от ${range.min} $`;
  if (range.max != null) return `до ${range.max} $`;
  return "любая";
}

export function describeFilters(s: Subscriber): string {
  const parts: string[] = [];
  if (s.priceRanges != null && s.priceRanges.length > 0) {
    parts.push(`Цена: ${s.priceRanges.map(formatPriceRange).join(", ")}`);
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

  const priceButtons: InlineButton[] = PRICE_BUCKETS.map((b) => ({
    text: `${isPriceBucketSelected(subscriber, b) ? "✅ " : ""}${b.label}`,
    callback_data: `price:${b.key}`,
  }));

  return {
    inline_keyboard: [roomsRow, ...chunk(priceButtons, 2), [{ text: "♻️ Сбросить всё", callback_data: "reset" }]],
  };
}

export function mainMenuKeyboard(subscriber: Subscriber | null): ReplyKeyboard {
  const toggleButton = isActiveSubscriber(subscriber) ? UNSUBSCRIBE_BUTTON : SUBSCRIBE_BUTTON;
  return {
    keyboard: [[toggleButton], [FILTERS_BUTTON], [CLEAR_FILTERS_BUTTON]],
    resize_keyboard: true,
  };
}
