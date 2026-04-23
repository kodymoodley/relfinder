/**
 * Session-scoped query cache for SPARQL results.
 *
 * Entries are stored in a module-level Map so all callers share the same
 * instance within a browser session. Each entry carries an expiry timestamp;
 * stale entries are evicted lazily on the next `cacheGet` call.
 *
 * `cacheInvalidate()` is called by the connection store on disconnect so
 * cached results from one endpoint are never served to a different one.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
  value: T
  expires: number
}

const _store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | undefined {
  const entry = _store.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) {
    _store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  _store.set(key, { value, expires: Date.now() + ttlMs })
}

/** Clears all cached entries — call on disconnect or source change. */
export function cacheInvalidate(): void {
  _store.clear()
}

export function cacheSize(): number {
  return _store.size
}
