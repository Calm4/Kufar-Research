import type { Env } from "./env";

export async function getSeenIds(kv: KVNamespace): Promise<string[] | null> {
  const raw = await kv.get("seen_ids");
  if (raw === null) return null; // never run before
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSeenIds(kv: KVNamespace, ids: string[], maxSeenIds: number): Promise<void> {
  const trimmed = ids.slice(-maxSeenIds);
  await kv.put("seen_ids", JSON.stringify(trimmed));
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
