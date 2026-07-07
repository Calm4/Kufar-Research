export interface PriceRange {
  min?: number;
  max?: number;
}

export interface Subscriber {
  chatId: string;
  // Undefined/true = receiving notifications; false = paused via the
  // subscribe/unsubscribe toggle, filters kept for when they turn it back on.
  active?: boolean;
  priceRanges?: PriceRange[];
  rooms?: number[];
}

const SUBSCRIBERS_KEY = "subscribers";

// Older deployments stored subscribers in two prior shapes: a plain array of
// chat id strings (no filters at all), and later `{ chatId, minPrice,
// maxPrice, rooms }` (a single price range, before price filters became
// multi-select). Accept all three so existing KV data keeps working.
function normalize(raw: unknown): Subscriber[] {
  if (!Array.isArray(raw)) return [];
  const result: Subscriber[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      result.push({ chatId: entry });
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof (entry as { chatId?: unknown }).chatId !== "string") {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const subscriber: Subscriber = { chatId: e.chatId as string };

    if (Array.isArray(e.priceRanges)) {
      subscriber.priceRanges = e.priceRanges as PriceRange[];
    } else if (e.minPrice != null || e.maxPrice != null) {
      subscriber.priceRanges = [{ min: e.minPrice as number | undefined, max: e.maxPrice as number | undefined }];
    }
    if (Array.isArray(e.rooms)) subscriber.rooms = e.rooms as number[];
    if (typeof e.active === "boolean") subscriber.active = e.active;

    result.push(subscriber);
  }
  return result;
}

export async function getSubscribers(kv: KVNamespace): Promise<Subscriber[]> {
  const raw = await kv.get(SUBSCRIBERS_KEY);
  if (raw === null) return [];
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function getSubscriber(kv: KVNamespace, chatId: string): Promise<Subscriber | null> {
  const subscribers = await getSubscribers(kv);
  return subscribers.find((s) => s.chatId === chatId) ?? null;
}

async function saveSubscribers(kv: KVNamespace, subscribers: Subscriber[]): Promise<void> {
  await kv.put(SUBSCRIBERS_KEY, JSON.stringify(subscribers));
}

// Creates a subscriber (no filters) if chatId is new, or re-activates one
// that had previously paused notifications — their filters are untouched
// either way. Returns true if this call actually changed anything (new
// subscriber or reactivation), false if they were already active.
export async function addSubscriber(kv: KVNamespace, chatId: string): Promise<boolean> {
  const subscribers = await getSubscribers(kv);
  const idx = subscribers.findIndex((s) => s.chatId === chatId);
  if (idx < 0) {
    await saveSubscribers(kv, [...subscribers, { chatId }]);
    return true;
  }
  if (subscribers[idx].active === false) {
    subscribers[idx] = { ...subscribers[idx], active: true };
    await saveSubscribers(kv, subscribers);
    return true;
  }
  return false;
}

// Creates the subscriber if missing, then applies the given field updates.
// Passing `undefined` for a field clears it (JSON.stringify drops undefined
// properties, so a cleared filter simply stops being stored).
export async function updateSubscriber(
  kv: KVNamespace,
  chatId: string,
  updates: Partial<Omit<Subscriber, "chatId">>
): Promise<Subscriber> {
  const subscribers = await getSubscribers(kv);
  const idx = subscribers.findIndex((s) => s.chatId === chatId);
  const updated: Subscriber = idx >= 0 ? { ...subscribers[idx], ...updates } : { chatId, ...updates };
  if (idx >= 0) subscribers[idx] = updated;
  else subscribers.push(updated);
  await saveSubscribers(kv, subscribers);
  return updated;
}
