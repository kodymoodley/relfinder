import type { CachedEntity, EvictionPolicy, InterestEntry } from '../types'

/**
 * Computes a combined relevance score in [0, 1] for an entity.
 * Entries with the lowest score are evicted first.
 *
 * Formula: 50% interest signals + 50% recency decay.
 * Weights are intentional tuning knobs — adjust as A/B data accumulates.
 */
function score(entity: CachedEntity, interest: InterestEntry | undefined, now: number): number {
  const daysSince = (now - entity.lastAccessed) / 86_400_000
  const recency = Math.exp(-0.3 * daysSince)

  if (interest === undefined) return recency * 0.1

  const raw =
    0.4 * Math.min(interest.selectCount / 10, 1) +
    0.3 * Math.min(interest.viewCount / 20, 1) +
    0.2 * Math.min(interest.dwellMs / 60_000, 1) +
    0.1 * (interest.pinned ? 1 : 0) -
    0.1 * (interest.dismissed ? 1 : 0)

  return 0.5 * Math.max(0, raw) + 0.5 * recency
}

/**
 * Relevance-scored eviction: removes the entities with the lowest combined
 * interest + recency score, preserving entities the user cares about most.
 */
export const relevanceScoredPolicy: EvictionPolicy = {
  name: 'relevance-scored',

  selectVictims(
    entries: CachedEntity[],
    interest: Map<string, InterestEntry>,
    targetSize: number,
  ): string[] {
    const excess = entries.length - targetSize
    if (excess <= 0) return []
    const now = Date.now()
    return [...entries]
      .sort((a, b) => score(a, interest.get(a.iri), now) - score(b, interest.get(b.iri), now))
      .slice(0, excess)
      .map((e) => e.iri)
  },
}
