import { describe, it, expect, beforeEach } from 'vitest'
import type { InterestEntry, ScoredEntity } from '../search/types'
import { weightedSumFusion } from '../search/fusion/weightedSum'
import { recordSelect, recordDismiss, snapshot, clear } from '../search/interestModel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScoredEntity(iri: string, bm25Score: number): ScoredEntity {
  return {
    iri,
    label: iri.split('/').pop() ?? iri,
    altLabels: [],
    classIri: 'http://example.org/Thing',
    classLabel: 'Thing',
    description: '',
    addedAt: Date.now(),
    lastAccessed: Date.now(),
    bm25Score,
    semanticScore: 0,
    affinityScore: 0,
    finalScore: 0,
    source: 'index',
  }
}

function makeInterestMap(entries: Partial<InterestEntry>[] = []): Map<string, InterestEntry> {
  const map = new Map<string, InterestEntry>()
  for (const e of entries) {
    const iri = e.iri ?? 'http://example.org/Unknown'
    map.set(iri, {
      iri,
      selectCount: 0,
      viewCount: 0,
      dwellMs: 0,
      pinned: false,
      dismissed: false,
      lastSeen: Date.now(),
      ...e,
    })
  }
  return map
}

beforeEach(() => {
  localStorage.clear()
  clear()
})

// ── weightedSumFusion ─────────────────────────────────────────────────────────

describe('weightedSumFusion', () => {
  const noInterest = new Map<string, InterestEntry>()

  it('returns empty array when bm25Results is empty', () => {
    expect(weightedSumFusion.fuse([], [], noInterest)).toHaveLength(0)
  })

  it('orders results by BM25 score when affinity is equal', () => {
    const results = [
      makeScoredEntity('http://e.org/Low', 0.2),
      makeScoredEntity('http://e.org/High', 0.9),
      makeScoredEntity('http://e.org/Mid', 0.5),
    ]
    const fused = weightedSumFusion.fuse(results, [], noInterest)
    expect(fused[0]?.iri).toBe('http://e.org/High')
    expect(fused[1]?.iri).toBe('http://e.org/Mid')
    expect(fused[2]?.iri).toBe('http://e.org/Low')
  })

  it('affinity boost can raise a lower-BM25 entity above a higher-BM25 one', () => {
    const interest = makeInterestMap([{ iri: 'http://e.org/Low', selectCount: 10 }])
    const results = [
      makeScoredEntity('http://e.org/High', 0.9),
      makeScoredEntity('http://e.org/Low', 0.3), // lower text score but heavily selected
    ]
    const fused = weightedSumFusion.fuse(results, [], interest)
    // Low has bm25=0.3, affinity=1.0 → finalScore = 0.8*0.3 + 0.2*1.0 = 0.44
    // High has bm25=0.9, affinity=0   → finalScore = 0.8*0.9 + 0.2*0   = 0.72
    // High should still win (affinity weight is intentionally modest)
    expect(fused[0]?.iri).toBe('http://e.org/High')
  })

  it('filters dismissed entities from results', () => {
    const interest = makeInterestMap([{ iri: 'http://e.org/Dismissed', dismissed: true }])
    const results = [
      makeScoredEntity('http://e.org/Dismissed', 0.9),
      makeScoredEntity('http://e.org/Kept', 0.5),
    ]
    const fused = weightedSumFusion.fuse(results, [], interest)
    expect(fused).toHaveLength(1)
    expect(fused[0]?.iri).toBe('http://e.org/Kept')
  })

  it('populates affinityScore and finalScore on each result', () => {
    const results = [makeScoredEntity('http://e.org/A', 0.8)]
    const fused = weightedSumFusion.fuse(results, [], noInterest)
    expect(fused[0]?.affinityScore).toBeDefined()
    expect(fused[0]?.finalScore).toBeDefined()
    expect(typeof fused[0]?.finalScore).toBe('number')
  })

  it('accepts semantic results without throwing (Phase 1: ignored)', () => {
    const semantic = [makeScoredEntity('http://e.org/Semantic', 0.95)]
    const bm25 = [makeScoredEntity('http://e.org/BM25', 0.7)]
    expect(() => weightedSumFusion.fuse(bm25, semantic, noInterest)).not.toThrow()
    // Semantic results are not mixed in during Phase 1
    const fused = weightedSumFusion.fuse(bm25, semantic, noInterest)
    expect(fused).toHaveLength(1)
    expect(fused[0]?.iri).toBe('http://e.org/BM25')
  })

  it('integrates with a real interest model snapshot', () => {
    recordSelect('http://e.org/Popular')
    recordSelect('http://e.org/Popular')
    recordDismiss('http://e.org/Dismissed')

    const interest = snapshot()
    const results = [
      // Popular has higher BM25 AND affinity — should clearly win over Unknown
      makeScoredEntity('http://e.org/Popular', 0.8),
      makeScoredEntity('http://e.org/Dismissed', 0.9),
      makeScoredEntity('http://e.org/Unknown', 0.7),
    ]
    const fused = weightedSumFusion.fuse(results, [], interest)
    expect(fused.map((r) => r.iri)).not.toContain('http://e.org/Dismissed')
    const popularIdx = fused.findIndex((r) => r.iri === 'http://e.org/Popular')
    const unknownIdx = fused.findIndex((r) => r.iri === 'http://e.org/Unknown')
    // Popular should rank above Unknown due to affinity boost
    expect(popularIdx).toBeLessThan(unknownIdx)
  })

  it('does not mutate the input bm25Results array', () => {
    const results = [makeScoredEntity('http://e.org/A', 0.5)]
    const original = [...results]
    weightedSumFusion.fuse(results, [], noInterest)
    expect(results[0]?.finalScore).toBe(0) // original object unchanged
    expect(results).toHaveLength(original.length)
  })
})
