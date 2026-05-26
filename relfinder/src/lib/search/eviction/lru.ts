import type { CachedEntity, EvictionPolicy, InterestEntry } from '../types'

/**
 * Least-recently-accessed eviction: removes the entries with the oldest
 * lastAccessed timestamps until the cache fits within targetSize.
 */
export const lruPolicy: EvictionPolicy = {
  name: 'lru',

  selectVictims(
    entries: CachedEntity[],
    _interest: Map<string, InterestEntry>,
    targetSize: number,
  ): string[] {
    const excess = entries.length - targetSize
    if (excess <= 0) return []
    return [...entries]
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, excess)
      .map((e) => e.iri)
  },
}
