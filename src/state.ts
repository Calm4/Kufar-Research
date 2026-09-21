import type { Env } from "./env";
import type { CityId } from "./cities";
import type { ListingSourceId } from "./hotness";

export const LEGACY_SEEN_IDS_KEY = "seen_ids";

export function seenIdsKey(source: ListingSourceId, cityId: CityId): string {
  return `seen_ids:${source}:${cityId}`;
}

export async function getSeenIds(
  kv: KVNamespace,
  key = LEGACY_SEEN_IDS_KEY
): Promise<string[] | null> {
  const raw = await kv.get(key);
  if (raw === null) return null; // never run before
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSeenIds(
  kv: KVNamespace,
  ids: string[],
  maxSeenIds: number,
  key = LEGACY_SEEN_IDS_KEY
): Promise<void> {
  const trimmed = ids.slice(-maxSeenIds);
  await kv.put(key, JSON.stringify(trimmed));
}

export interface FeedRunStatus {
  source: ListingSourceId;
  cityId: CityId;
  status: number;
  foundCount: number;
  newCount: number;
  firstRun: boolean;
  blocked: boolean;
  error?: string;
}

export interface RunStatus {
  ranAt: string; // ISO timestamp
  status: number;
  foundCount: number;
  newCount: number;
  firstRun: boolean;
  blocked: boolean;
  telegramErrorCount: number;
  subscriberCount: number;
  feeds?: FeedRunStatus[];
}

// Written on every run (success or blocked) so `/status` always reflects
// reality — lets you check "is this thing actually alive" without digging
// through Cloudflare Observability logs.
export async function saveLastRunStatus(kv: KVNamespace, status: RunStatus): Promise<void> {
  await kv.put("last_run", JSON.stringify(status));
}

export async function getLastRunStatus(kv: KVNamespace): Promise<RunStatus | null> {
  const raw = await kv.get("last_run");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as RunStatus;
  } catch {
    return null;
  }
}

export function isAuthorized(env: Env, url: URL): boolean {
  return url.searchParams.get("token") === env.ADMIN_TOKEN && env.ADMIN_TOKEN.length > 0;
}
