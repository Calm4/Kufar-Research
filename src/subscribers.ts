export interface Subscriber {
  chatId: string;
  minPrice?: number;
  maxPrice?: number;
  rooms?: number[];
}

const SUBSCRIBERS_KEY = "subscribers";

// Older deployments stored subscribers as a plain array of chat id strings
// (no filters). Accept both shapes so existing KV data keeps working.
function normalize(raw: unknown): Subscriber[] {
  if (!Array.isArray(raw)) return [];
  const result: Subscriber[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      result.push({ chatId: entry });
    } else if (entry && typeof entry === "object" && typeof (entry as { chatId?: unknown }).chatId === "string") {
      result.push(entry as Subscriber);
    }
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

// Adds a subscriber with no filters if not already present. Returns true if
// newly added, false if that chat id was already subscribed.
export async function addSubscriber(kv: KVNamespace, chatId: string): Promise<boolean> {
  const subscribers = await getSubscribers(kv);
  if (subscribers.some((s) => s.chatId === chatId)) return false;
  await saveSubscribers(kv, [...subscribers, { chatId }]);
  return true;
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
