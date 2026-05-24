import type { InterestEntry, RankingFusion, ScoredEntity } from '../types'
import { computeAffinity } from '../interestModel'

// Weights are intentional tuning knobs — adjust as A/B data accumulates.
const W_TEXT = 0.8
const W_AFF = 0.2

/**
 * Weighted-sum fusion: combines BM25 text relevance with behavioural affinity
 * into a single linear score. Dismissed entities are removed from results.
 *
 * Semantic results are accepted by the interface but ignored in Phase 1 —
 * the parameter is reserved for Phase 2 without any interface change.
 */
export const weightedSumFusion: RankingFusion = {
  name: 'weighted-sum',

  fuse(
    bm25Results: ScoredEntity[],
    _semanticResults: ScoredEntity[],
    interest: Map<string, InterestEntry>,
  ): ScoredEntity[] {
    return bm25Results
      .filter((e) => !interest.get(e.iri)?.dismissed)
      .map((e) => {
        const aff = computeAffinity(interest.get(e.iri) ?? defaultEntry(e.iri))
        return {
          ...e,
          affinityScore: aff,
          finalScore: W_TEXT * e.bm25Score + W_AFF * aff,
        }
      })
      .sort((a, b) => b.finalScore - a.finalScore)
  },
}

function defaultEntry(iri: string): InterestEntry {
  return {
    iri,
    selectCount: 0,
    viewCount: 0,
    dwellMs: 0,
    pinned: false,
    dismissed: false,
    lastSeen: 0,
  }
}
