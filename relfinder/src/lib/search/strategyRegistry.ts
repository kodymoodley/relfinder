import type { EvictionPolicy, RankingFusion } from './types'
import { lruPolicy } from './eviction/lru'
import { relevanceScoredPolicy } from './eviction/relevanceScored'
import { ttlHybridPolicy } from './eviction/ttlHybrid'
import { weightedSumFusion } from './fusion/weightedSum'

// ── Strategy registries ───────────────────────────────────────────────────────

export const evictionPolicies = {
  lru: lruPolicy,
  'relevance-scored': relevanceScoredPolicy,
  'ttl-hybrid': ttlHybridPolicy,
} satisfies Record<string, EvictionPolicy>

export const fusionStrategies = {
  'weighted-sum': weightedSumFusion,
} satisfies Record<string, RankingFusion>

export type EvictionPolicyName = keyof typeof evictionPolicies
export type FusionStrategyName = keyof typeof fusionStrategies

// ── Central search configuration ──────────────────────────────────────────────

/**
 * The single switch-board for the intelligent search system.
 *
 * Setting indexEnabled = false makes EntitySearch fall through to the original
 * SPARQL path with zero disruption to existing behaviour — the new system can
 * be disabled instantly if anything goes wrong.
 */
export const searchConfig = {
  /** Master switch. false → all search goes through the legacy SPARQL path. */
  indexEnabled: true,

  /** Whether the prefetch worker is allowed to issue background SPARQL calls. */
  prefetchEnabled: true,

  eviction: 'lru' as EvictionPolicyName,
  fusion: 'weighted-sum' as FusionStrategyName,

  /** Mirror of entityCache.CACHE_MAX — kept here for observability. */
  cacheMax: 5_000,
}
