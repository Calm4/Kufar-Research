const SUBSCRIBERS_KEY = "subscribers";

export async function getSubscribers(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(SUBSCRIBERS_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns true if the chat id was newly added, false if it was already subscribed.
export async function addSubscriber(kv: KVNamespace, chatId: string): Promise<boolean> {
  const subscribers = await getSubscribers(kv);
  if (subscribers.includes(chatId)) return false;
  await kv.put(SUBSCRIBERS_KEY, JSON.stringify([...subscribers, chatId]));
  return true;
}
