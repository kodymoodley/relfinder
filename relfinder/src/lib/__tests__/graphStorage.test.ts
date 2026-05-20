import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveGraph,
  loadGraph,
  lookupGraph,
  listRecentGraphs,
  deleteGraphEntry,
  clearAllGraphs,
  makeGraphId,
} from '../cache/graphStorage'
import type { RelationshipGraph, EntitySearchResult } from '../sparql/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://example.org/sparql'

const ENTITY1: EntitySearchResult = {
  iri: 'http://example.org/Alice',
  label: 'Alice',
  class: 'http://example.org/Person',
}
const ENTITY2: EntitySearchResult = {
  iri: 'http://example.org/Bob',
  label: 'Bob',
  class: 'http://example.org/Person',
}

function makeGraph(overrides: Partial<RelationshipGraph> = {}): RelationshipGraph {
  return {
    nodes: [
      {
        id: 0,
        iri: 'http://example.org/Alice',
        label: 'Alice',
        class: 'http://example.org/Person',
        isEndpoint: true,
      },
      {
        id: 1,
        iri: 'http://example.org/Bob',
        label: 'Bob',
        class: 'http://example.org/Person',
        isEndpoint: true,
      },
    ],
    edges: [{ sid: 0, tid: 1, iris: ['http://example.org/knows'], label: 'knows' }],
    classes: ['http://example.org/Person'],
    allLabels: new Map([['http://example.org/knows', [{ value: 'knows', lang: 'en' }]]]),
    ...overrides,
  }
}

const DEFAULT_OPTIONS = {
  maxDistance: 2,
  ignoredProperties: ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'],
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('graphStorage', () => {
  describe('saveGraph / loadGraph round-trip', () => {
    it('persists and restores all graph fields including Map<string, LabelEntry[]>', () => {
      const graph = makeGraph()
      const id = saveGraph(
        ENDPOINT,
        ENTITY1,
        ENTITY2,
        DEFAULT_OPTIONS.maxDistance,
        DEFAULT_OPTIONS.ignoredProperties,
        graph,
      )

      const restored = loadGraph(id)
      expect(restored).not.toBeNull()
      expect(restored!.nodes).toHaveLength(2)
      expect(restored!.nodes[0]).toEqual(graph.nodes[0])
      expect(restored!.edges).toHaveLength(1)
      expect(restored!.classes).toEqual(['http://example.org/Person'])

      // Map is correctly reconstructed
      expect(restored!.allLabels).toBeInstanceOf(Map)
      expect(restored!.allLabels.get('http://example.org/knows')).toEqual([
        { value: 'knows', lang: 'en' },
      ])
    })

    it('allLabels with multiple languages round-trips correctly', () => {
      const graph = makeGraph({
        allLabels: new Map([
          [
            'http://example.org/knows',
            [
              { value: 'knows', lang: 'en' },
              { value: 'kennt', lang: 'de' },
            ],
          ],
        ]),
      })
      const id = saveGraph(
        ENDPOINT,
        ENTITY1,
        ENTITY2,
        DEFAULT_OPTIONS.maxDistance,
        DEFAULT_OPTIONS.ignoredProperties,
        graph,
      )
      const restored = loadGraph(id)

      const labels = restored!.allLabels.get('http://example.org/knows')!
      expect(labels).toHaveLength(2)
      expect(labels.find((l) => l.lang === 'de')?.value).toBe('kennt')
    })
  })

  describe('lookupGraph', () => {
    it('finds an entry by endpoint + entity IRIs + options', () => {
      saveGraph(
        ENDPOINT,
        ENTITY1,
        ENTITY2,
        DEFAULT_OPTIONS.maxDistance,
        DEFAULT_OPTIONS.ignoredProperties,
        makeGraph(),
      )

      const result = lookupGraph(
        ENDPOINT,
        ENTITY1.iri,
        ENTITY2.iri,
        DEFAULT_OPTIONS.maxDistance,
        DEFAULT_OPTIONS.ignoredProperties,
      )
      expect(result).not.toBeNull()
      expect(result!.nodes).toHaveLength(2)
    })

    it('misses when maxDistance differs', () => {
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      expect(lookupGraph(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 3, [])).toBeNull()
    })

    it('misses when ignoredProperties differ', () => {
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, ['http://example.org/p1'], makeGraph())
      expect(
        lookupGraph(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, ['http://example.org/p2']),
      ).toBeNull()
    })

    it('is order-sensitive for entity pair (A→B ≠ B→A)', () => {
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      // Reversed pair should not match
      expect(lookupGraph(ENDPOINT, ENTITY2.iri, ENTITY1.iri, 2, [])).toBeNull()
    })

    it('misses for a different endpoint even with identical entities + options', () => {
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      expect(
        lookupGraph('https://other.example/sparql', ENTITY1.iri, ENTITY2.iri, 2, []),
      ).toBeNull()
    })

    it('returns null for an entry that was never saved', () => {
      expect(lookupGraph(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, [])).toBeNull()
    })
  })

  describe('TTL', () => {
    it('loadGraph returns null and cleans up when entry is expired', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      const id = saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())

      // Advance past 7-day TTL
      vi.setSystemTime(now + 7 * 24 * 60 * 60 * 1000 + 1)

      expect(loadGraph(id)).toBeNull()
      // Index entry should be gone
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
    })

    it('loadGraph refreshes savedAt so repeated access resets TTL', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      const id = saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())

      // Advance to 6 days — still valid
      vi.setSystemTime(now + 6 * 24 * 60 * 60 * 1000)
      expect(loadGraph(id)).not.toBeNull()

      // Now advance another 6 days from the access time — should still be valid
      // because savedAt was refreshed on the first access
      vi.setSystemTime(now + 6 * 24 * 60 * 60 * 1000 + 6 * 24 * 60 * 60 * 1000)
      expect(loadGraph(id)).not.toBeNull()
    })
  })

  describe('duplicate saves', () => {
    it('re-saving with the same entity pair moves entry to front without duplication', () => {
      // Save A→B, then C→D, then A→B again
      const e3: EntitySearchResult = {
        iri: 'http://example.org/C',
        label: 'C',
        class: 'http://example.org/Thing',
      }
      const e4: EntitySearchResult = {
        iri: 'http://example.org/D',
        label: 'D',
        class: 'http://example.org/Thing',
      }

      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      saveGraph(ENDPOINT, e3, e4, 2, [], makeGraph())
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph()) // re-save A→B

      const recent = listRecentGraphs(ENDPOINT)
      expect(recent).toHaveLength(2) // no duplicate
      expect(recent[0].entity1.iri).toBe(ENTITY1.iri) // moved to front
    })
  })

  describe('HISTORY_LIMIT per endpoint', () => {
    it('prunes oldest entries when limit is exceeded', () => {
      const limit = 20

      // Fill up to the limit
      for (let i = 0; i < limit; i++) {
        const e1: EntitySearchResult = {
          iri: `http://example.org/E${i}a`,
          label: `E${i}a`,
          class: 'http://example.org/Thing',
        }
        const e2: EntitySearchResult = {
          iri: `http://example.org/E${i}b`,
          label: `E${i}b`,
          class: 'http://example.org/Thing',
        }
        saveGraph(ENDPOINT, e1, e2, 2, [], makeGraph())
      }
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(limit)

      // One more entry — oldest should be pruned
      const extra1: EntitySearchResult = {
        iri: 'http://example.org/extra1',
        label: 'Extra1',
        class: 'http://example.org/Thing',
      }
      const extra2: EntitySearchResult = {
        iri: 'http://example.org/extra2',
        label: 'Extra2',
        class: 'http://example.org/Thing',
      }
      saveGraph(ENDPOINT, extra1, extra2, 2, [], makeGraph())

      const recent = listRecentGraphs(ENDPOINT)
      expect(recent).toHaveLength(limit)
      // The first entry saved (E0a → E0b) should have been pruned
      expect(recent.some((e) => e.entity1.iri === 'http://example.org/E0a')).toBe(false)
      // The new extra entry should be at the front
      expect(recent[0].entity1.iri).toBe('http://example.org/extra1')
    })

    it('limits are applied per-endpoint, not globally', () => {
      const ep1 = 'https://ep1.example/sparql'
      const ep2 = 'https://ep2.example/sparql'
      const limit = 20

      for (let i = 0; i < limit; i++) {
        const e1: EntitySearchResult = {
          iri: `http://example.org/E${i}a`,
          label: `E${i}a`,
          class: 'http://example.org/Thing',
        }
        const e2: EntitySearchResult = {
          iri: `http://example.org/E${i}b`,
          label: `E${i}b`,
          class: 'http://example.org/Thing',
        }
        saveGraph(ep1, e1, e2, 2, [], makeGraph())
        saveGraph(ep2, e1, e2, 2, [], makeGraph())
      }

      expect(listRecentGraphs(ep1)).toHaveLength(limit)
      expect(listRecentGraphs(ep2)).toHaveLength(limit)
    })
  })

  describe('deleteGraphEntry', () => {
    it('removes the entry from the index and the data key', () => {
      const id = saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      expect(loadGraph(id)).not.toBeNull()

      deleteGraphEntry(id)
      expect(loadGraph(id)).toBeNull()
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
      expect(localStorage.getItem(`rf:graph-data:v1:${id}`)).toBeNull()
    })

    it('is a no-op for an unknown id', () => {
      expect(() => deleteGraphEntry('nonexistent-id')).not.toThrow()
    })
  })

  describe('clearAllGraphs', () => {
    it('removes all entries for the target endpoint', () => {
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      saveGraph(ENDPOINT, ENTITY2, ENTITY1, 2, [], makeGraph())

      clearAllGraphs(ENDPOINT)
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
    })

    it('leaves entries for other endpoints untouched', () => {
      const other = 'https://other.example/sparql'
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      saveGraph(other, ENTITY1, ENTITY2, 2, [], makeGraph())

      clearAllGraphs(ENDPOINT)
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
      expect(listRecentGraphs(other)).toHaveLength(1)
    })
  })

  describe('listRecentGraphs', () => {
    it('returns metadata without graph data, newest first', () => {
      const e3: EntitySearchResult = {
        iri: 'http://example.org/C',
        label: 'C',
        class: 'http://example.org/Thing',
      }
      const e4: EntitySearchResult = {
        iri: 'http://example.org/D',
        label: 'D',
        class: 'http://example.org/Thing',
      }

      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      saveGraph(ENDPOINT, e3, e4, 3, [], makeGraph())

      const recent = listRecentGraphs(ENDPOINT)
      expect(recent).toHaveLength(2)

      // Newest first
      expect(recent[0].entity1.iri).toBe(e3.iri)
      expect(recent[0].maxDistance).toBe(3)
      expect(recent[1].entity1.iri).toBe(ENTITY1.iri)

      // No graph data in metadata
      expect((recent[0] as { graph?: unknown }).graph).toBeUndefined()
    })

    it('excludes entries whose TTL has expired', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)
      saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())

      vi.setSystemTime(now + 7 * 24 * 60 * 60 * 1000 + 1)
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
    })

    it('returns empty array when nothing has been saved', () => {
      expect(listRecentGraphs(ENDPOINT)).toHaveLength(0)
    })
  })

  describe('makeGraphId', () => {
    it('produces the same ID for the same inputs', () => {
      const id1 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, ['http://example.org/p'])
      const id2 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, ['http://example.org/p'])
      expect(id1).toBe(id2)
    })

    it('produces different IDs for different endpoints', () => {
      const id1 = makeGraphId('https://ep1.example', ENTITY1.iri, ENTITY2.iri, 2, [])
      const id2 = makeGraphId('https://ep2.example', ENTITY1.iri, ENTITY2.iri, 2, [])
      expect(id1).not.toBe(id2)
    })

    it('produces different IDs for different maxDistance', () => {
      const id1 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, [])
      const id2 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 3, [])
      expect(id1).not.toBe(id2)
    })

    it('sorts ignoredProperties before hashing so order does not matter', () => {
      const id1 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, ['http://p1', 'http://p2'])
      const id2 = makeGraphId(ENDPOINT, ENTITY1.iri, ENTITY2.iri, 2, ['http://p2', 'http://p1'])
      expect(id1).toBe(id2)
    })
  })

  describe('storage failure resilience', () => {
    it('saveGraph returns the id even when localStorage is full', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('storage full', 'QuotaExceededError')
      })
      const id = saveGraph(ENDPOINT, ENTITY1, ENTITY2, 2, [], makeGraph())
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
  })
})
