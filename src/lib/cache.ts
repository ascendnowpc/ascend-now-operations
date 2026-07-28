const store = new Map<string, { data: unknown; ts: number }>();
const TTL_MS = 60_000; // 1 minute

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data as T;
  return undefined;
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() });
}

export function invalidateCache(...keys: string[]): void {
  for (const k of keys) store.delete(k);
}

export function invalidateCachePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
