import type { CachedEntity, EvictionPolicy, InterestEntry } from '../types'
import { lruPolicy } from './lru'

/** Matches the 7-day TTL used by graphStorage and schemaStorage. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * TTL-hybrid eviction: expired entries are removed first regardless of interest
 * score, then LRU is applied to live entries if further eviction is still needed.
 *
 * This ensures stale data never accumulates while still preferring to keep
 * recently-accessed live entries over arbitrary LRU selection.
 */
export const ttlHybridPolicy: EvictionPolicy = {
  name: 'ttl-hybrid',

  selectVictims(
    entries: CachedEntity[],
    interest: Map<string, InterestEntry>,
    targetSize: number,
  ): string[] {
    if (entries.length <= targetSize) return []
    const now = Date.now()
    const expired = entries.filter((e) => now - e.addedAt > TTL_MS)
    const live = entries.filter((e) => now - e.addedAt <= TTL_MS)
    const expiredIris = expired.map((e) => e.iri)

    const liveExcess = live.length - targetSize
    if (liveExcess <= 0) return expiredIris

    return [...expiredIris, ...lruPolicy.selectVictims(live, interest, targetSize)]
  },
}
