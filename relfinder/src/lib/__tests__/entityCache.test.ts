import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CachedEntity, InterestEntry } from '../search/types'
import { lruPolicy } from '../search/eviction/lru'
import { relevanceScoredPolicy } from '../search/eviction/relevanceScored'
import { ttlHybridPolicy } from '../search/eviction/ttlHybrid'

// ── IDB mock (hoisted before any module imports) ──────────────────────────────

vi.mock('idb', () => {
  const tx = {
    store: {
      put: vi.fn().mockResolvedValue('iri'),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    done: Promise.resolve(),
  }
  return {
    openDB: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockReturnValue(tx),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  }
})

import * as cache from '../search/entityCache'
import { CACHE_MAX } from '../search/entityCache'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntity(iri: string, overrides: Partial<CachedEntity> = {}): CachedEntity {
  return {
    iri,
    label: iri.split('/').pop() ?? iri,
    altLabels: [],
    classIri: 'http://example.org/Thing',
    classLabel: 'Thing',
    description: '',
    addedAt: Date.now(),
    lastAccessed: Date.now(),
    ...overrides,
  }
}

function makeInterest(
  iri: string,
  overrides: Partial<InterestEntry> = {},
): [string, InterestEntry] {
  return [
    iri,
    {
      iri,
      selectCount: 0,
      viewCount: 0,
      dwellMs: 0,
      pinned: false,
      dismissed: false,
      lastSeen: Date.now(),
      ...overrides,
    },
  ]
}

// ── entityCache module ────────────────────────────────────────────────────────

describe('entityCache', () => {
  beforeEach(() => cache._resetForTest())

  describe('cacheAdd / cacheGet / cacheHas / cacheSize / cacheAll', () => {
    it('stores entities and retrieves them by IRI', () => {
      cache.cacheAdd([makeEntity('http://example.org/A')])
      expect(cache.cacheHas('http://example.org/A')).toBe(true)
      expect(cache.cacheGet('http://example.org/A')).toMatchObject({ label: 'A' })
    })

    it('cacheGet returns undefined for unknown IRI', () => {
      expect(cache.cacheGet('http://example.org/Missing')).toBeUndefined()
    })

    it('cacheAll returns all stored entities', () => {
      cache.cacheAdd([makeEntity('http://example.org/A'), makeEntity('http://example.org/B')])
      expect(cache.cacheAll()).toHaveLength(2)
    })

    it('cacheSize tracks count correctly', () => {
      expect(cache.cacheSize()).toBe(0)
      cache.cacheAdd([makeEntity('http://example.org/A')])
      expect(cache.cacheSize()).toBe(1)
    })

    it('re-adding an existing IRI preserves its original addedAt', () => {
      const early = Date.now() - 60_000
      cache.cacheAdd([makeEntity('http://example.org/A', { addedAt: early })])
      cache.cacheAdd([makeEntity('http://example.org/A', { label: 'A-updated' })])
      const entity = cache.cacheGet('http://example.org/A')!
      expect(entity.addedAt).toBe(early)
      expect(entity.label).toBe('A-updated')
    })

    it('cacheAdd is a no-op for an empty array', () => {
      cache.cacheAdd([])
      expect(cache.cacheSize()).toBe(0)
    })

    it('cacheGet refreshes lastAccessed', () => {
      const before = Date.now() - 1_000
      cache.cacheAdd([makeEntity('http://example.org/A', { lastAccessed: before })])
      cache.cacheGet('http://example.org/A')
      const entity = cache.cacheAll().find((e) => e.iri === 'http://example.org/A')!
      expect(entity.lastAccessed).toBeGreaterThan(before)
    })
  })

  describe('cacheRemove', () => {
    it('removes entities by IRI', () => {
      cache.cacheAdd([makeEntity('http://example.org/A'), makeEntity('http://example.org/B')])
      cache.cacheRemove(['http://example.org/A'])
      expect(cache.cacheHas('http://example.org/A')).toBe(false)
      expect(cache.cacheHas('http://example.org/B')).toBe(true)
    })

    it('is a no-op for unknown IRIs', () => {
      cache.cacheAdd([makeEntity('http://example.org/A')])
      expect(() => cache.cacheRemove(['http://example.org/Unknown'])).not.toThrow()
      expect(cache.cacheSize()).toBe(1)
    })
  })

  describe('cacheClear', () => {
    it('wipes all entities', () => {
      cache.cacheAdd([makeEntity('http://example.org/A'), makeEntity('http://example.org/B')])
      cache.cacheClear()
      expect(cache.cacheSize()).toBe(0)
      expect(cache.cacheAll()).toHaveLength(0)
    })
  })

  describe('onAdd / onEvict hooks', () => {
    it('onAdd fires with the newly added entities', () => {
      const spy = vi.fn<(entities: CachedEntity[]) => void>()
      cache.hooks.onAdd = spy
      const entity = makeEntity('http://example.org/A')
      cache.cacheAdd([entity])
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]?.[0]).toHaveLength(1)
      expect(spy.mock.calls[0]?.[0]?.[0]?.iri).toBe('http://example.org/A')
    })

    it('onEvict fires when CACHE_MAX is exceeded', () => {
      const spy = vi.fn<(iris: string[]) => void>()
      cache.hooks.onEvict = spy
      const entities = Array.from({ length: CACHE_MAX + 1 }, (_, i) =>
        makeEntity(`http://example.org/E${i}`, { lastAccessed: i }),
      )
      cache.cacheAdd(entities)
      expect(spy).toHaveBeenCalledOnce()
      expect(spy.mock.calls[0]?.[0]).toHaveLength(1)
    })

    it('onAdd is not called when the array is empty', () => {
      const spy = vi.fn<(entities: CachedEntity[]) => void>()
      cache.hooks.onAdd = spy
      cache.cacheAdd([])
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('eviction', () => {
    it('does not evict when at exactly CACHE_MAX', () => {
      const spy = vi.fn<(iris: string[]) => void>()
      cache.hooks.onEvict = spy
      cache.cacheAdd(Array.from({ length: CACHE_MAX }, (_, i) => makeEntity(`http://e.org/E${i}`)))
      expect(spy).not.toHaveBeenCalled()
      expect(cache.cacheSize()).toBe(CACHE_MAX)
    })

    it('evicts exactly the LRU entry when CACHE_MAX + 1 entities are added', () => {
      const entities = Array.from({ length: CACHE_MAX + 1 }, (_, i) =>
        makeEntity(`http://example.org/E${i}`, { lastAccessed: i }),
      )
      cache.cacheAdd(entities)
      expect(cache.cacheSize()).toBe(CACHE_MAX)
      // E0 had the oldest lastAccessed (0) and should be gone
      expect(cache.cacheHas('http://example.org/E0')).toBe(false)
    })
  })

  describe('initEntityCache', () => {
    it('hydrates the in-memory map from IDB on first call', async () => {
      const { openDB } = await import('idb')
      const storedEntities: CachedEntity[] = [
        makeEntity('http://example.org/Persisted'),
      ]
      vi.mocked(openDB).mockResolvedValueOnce({
        getAll: vi.fn().mockResolvedValue(storedEntities),
        transaction: vi.fn().mockReturnValue({
          store: { put: vi.fn(), delete: vi.fn() },
          done: Promise.resolve(),
        }),
        clear: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      await cache.initEntityCache()
      expect(cache.cacheHas('http://example.org/Persisted')).toBe(true)
    })

    it('returns the same Promise on repeated calls', () => {
      const p1 = cache.initEntityCache()
      const p2 = cache.initEntityCache()
      expect(p1).toBe(p2)
    })

    it('degrades to in-memory-only when IDB throws', async () => {
      const { openDB } = await import('idb')
      vi.mocked(openDB).mockRejectedValueOnce(new Error('IDB unavailable'))
      await expect(cache.initEntityCache()).resolves.toBeUndefined()
      // Cache still works in-memory after IDB failure
      cache.cacheAdd([makeEntity('http://example.org/A')])
      expect(cache.cacheHas('http://example.org/A')).toBe(true)
    })
  })
})

// ── LRU eviction policy ───────────────────────────────────────────────────────

describe('lruPolicy', () => {
  const noInterest = new Map<string, InterestEntry>()

  it('returns empty array when entries fit within targetSize', () => {
    const entries = [makeEntity('http://e.org/A'), makeEntity('http://e.org/B')]
    expect(lruPolicy.selectVictims(entries, noInterest, 5)).toHaveLength(0)
  })

  it('returns empty array when entries exactly equal targetSize', () => {
    const entries = [makeEntity('http://e.org/A'), makeEntity('http://e.org/B')]
    expect(lruPolicy.selectVictims(entries, noInterest, 2)).toHaveLength(0)
  })

  it('selects the least-recently-accessed entry as the sole victim', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/Old', { lastAccessed: now - 3_000 }),
      makeEntity('http://e.org/Mid', { lastAccessed: now - 2_000 }),
      makeEntity('http://e.org/New', { lastAccessed: now - 1_000 }),
    ]
    const victims = lruPolicy.selectVictims(entries, noInterest, 2)
    expect(victims).toHaveLength(1)
    expect(victims[0]).toBe('http://e.org/Old')
  })

  it('selects multiple victims in LRU order', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/A', { lastAccessed: now - 4_000 }),
      makeEntity('http://e.org/B', { lastAccessed: now - 3_000 }),
      makeEntity('http://e.org/C', { lastAccessed: now - 2_000 }),
      makeEntity('http://e.org/D', { lastAccessed: now - 1_000 }),
    ]
    const victims = lruPolicy.selectVictims(entries, noInterest, 2)
    expect(victims).toHaveLength(2)
    expect(victims).toContain('http://e.org/A')
    expect(victims).toContain('http://e.org/B')
  })

  it('does not mutate the original entries array', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/A', { lastAccessed: now - 2_000 }),
      makeEntity('http://e.org/B', { lastAccessed: now - 1_000 }),
    ]
    const original = [...entries]
    lruPolicy.selectVictims(entries, noInterest, 1)
    expect(entries).toEqual(original)
  })
})

// ── Relevance-scored eviction policy ─────────────────────────────────────────

describe('relevanceScoredPolicy', () => {
  const now = Date.now()

  it('returns empty array when entries fit within targetSize', () => {
    const entries = [makeEntity('http://e.org/A', { lastAccessed: now })]
    expect(
      relevanceScoredPolicy.selectVictims(entries, new Map(), 5),
    ).toHaveLength(0)
  })

  it('treats entities with no interest entry as low-scored (evicted first)', () => {
    const interest = new Map<string, InterestEntry>([
      makeInterest('http://e.org/Known', { selectCount: 5 }),
    ])
    const entries = [
      makeEntity('http://e.org/Known', { lastAccessed: now }),
      makeEntity('http://e.org/Unknown', { lastAccessed: now }),
    ]
    const victims = relevanceScoredPolicy.selectVictims(entries, interest, 1)
    expect(victims[0]).toBe('http://e.org/Unknown')
  })

  it('evicts the dismissed entity over a neutral one', () => {
    const interest = new Map<string, InterestEntry>([
      makeInterest('http://e.org/Dismissed', { dismissed: true }),
      makeInterest('http://e.org/Neutral'),
    ])
    const entries = [
      makeEntity('http://e.org/Dismissed', { lastAccessed: now }),
      makeEntity('http://e.org/Neutral', { lastAccessed: now }),
    ]
    const victims = relevanceScoredPolicy.selectVictims(entries, interest, 1)
    expect(victims[0]).toBe('http://e.org/Dismissed')
  })

  it('retains pinned entity over an unpinned one', () => {
    const interest = new Map<string, InterestEntry>([
      makeInterest('http://e.org/Pinned', { pinned: true }),
      makeInterest('http://e.org/Plain'),
    ])
    const entries = [
      makeEntity('http://e.org/Pinned', { lastAccessed: now }),
      makeEntity('http://e.org/Plain', { lastAccessed: now }),
    ]
    const victims = relevanceScoredPolicy.selectVictims(entries, interest, 1)
    expect(victims[0]).toBe('http://e.org/Plain')
  })

  it('retains highly-selected entity over an unselected one', () => {
    const interest = new Map<string, InterestEntry>([
      makeInterest('http://e.org/Popular', { selectCount: 10 }),
      makeInterest('http://e.org/Ignored', { selectCount: 0 }),
    ])
    const entries = [
      makeEntity('http://e.org/Popular', { lastAccessed: now }),
      makeEntity('http://e.org/Ignored', { lastAccessed: now }),
    ]
    const victims = relevanceScoredPolicy.selectVictims(entries, interest, 1)
    expect(victims[0]).toBe('http://e.org/Ignored')
  })
})

// ── TTL-hybrid eviction policy ────────────────────────────────────────────────

describe('ttlHybridPolicy', () => {
  const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000
  const noInterest = new Map<string, InterestEntry>()

  it('returns empty array when entries fit within targetSize', () => {
    const entries = [makeEntity('http://e.org/A')]
    expect(ttlHybridPolicy.selectVictims(entries, noInterest, 5)).toHaveLength(0)
  })

  it('evicts expired entries before live ones', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/Expired', { addedAt: now - EIGHT_DAYS, lastAccessed: now }),
      makeEntity('http://e.org/Live-A', { addedAt: now, lastAccessed: now - 3_000 }),
      makeEntity('http://e.org/Live-B', { addedAt: now, lastAccessed: now - 1_000 }),
    ]
    // Target size 2 — only 1 eviction needed; expired should be chosen
    const victims = ttlHybridPolicy.selectVictims(entries, noInterest, 2)
    expect(victims).toContain('http://e.org/Expired')
    expect(victims).not.toContain('http://e.org/Live-A')
    expect(victims).not.toContain('http://e.org/Live-B')
  })

  it('falls back to LRU among live entries after expired are exhausted', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/Expired', { addedAt: now - EIGHT_DAYS, lastAccessed: now }),
      makeEntity('http://e.org/Live-Old', { addedAt: now, lastAccessed: now - 5_000 }),
      makeEntity('http://e.org/Live-New', { addedAt: now, lastAccessed: now }),
    ]
    // Target size 1 — need to evict 2: the expired + the oldest live
    const victims = ttlHybridPolicy.selectVictims(entries, noInterest, 1)
    expect(victims).toContain('http://e.org/Expired')
    expect(victims).toContain('http://e.org/Live-Old')
    expect(victims).not.toContain('http://e.org/Live-New')
  })

  it('only evicts expired entries when that brings count to targetSize', () => {
    const now = Date.now()
    const entries = [
      makeEntity('http://e.org/Expired', { addedAt: now - EIGHT_DAYS }),
      makeEntity('http://e.org/Live', { addedAt: now }),
    ]
    const victims = ttlHybridPolicy.selectVictims(entries, noInterest, 1)
    expect(victims).toEqual(['http://e.org/Expired'])
  })
})
