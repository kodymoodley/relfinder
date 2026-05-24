import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SearchWorkerIn, SearchWorkerOut, ScoredEntity, CachedEntity } from '../search/types'

// ── Worker mock ───────────────────────────────────────────────────────────────
// Must be set up before the composable module is imported so that `new Worker()`
// inside ensureWorker() returns our mock instance.

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()

  /** Simulates a message arriving from the Worker thread. */
  respond(data: SearchWorkerOut): void {
    this.onmessage?.({ data } as MessageEvent)
  }
}

let _mock: MockWorker

vi.stubGlobal(
  'Worker',
  function MockWorkerConstructor(_url: unknown, _opts: unknown) {
    _mock = new MockWorker()
    return _mock
  },
)

import { useSearchIndex, _resetWorkerForTest } from '../../composables/useSearchIndex'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeScoredEntity(iri: string): ScoredEntity {
  return {
    iri,
    label: iri.split('/').pop() ?? iri,
    altLabels: [],
    classIri: 'http://example.org/Thing',
    classLabel: 'Thing',
    description: '',
    addedAt: Date.now(),
    lastAccessed: Date.now(),
    bm25Score: 0.8,
    semanticScore: 0,
    affinityScore: 0,
    finalScore: 0,
    source: 'index',
  }
}

function makeCachedEntity(iri: string): CachedEntity {
  return {
    iri,
    label: iri.split('/').pop() ?? iri,
    altLabels: [],
    classIri: 'http://example.org/Thing',
    classLabel: 'Thing',
    description: '',
    addedAt: Date.now(),
    lastAccessed: Date.now(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  _resetWorkerForTest()
})

describe('useSearchIndex', () => {
  describe('search()', () => {
    it('resolves immediately with [] for a blank query', async () => {
      const { search } = useSearchIndex()
      await expect(search('', 10)).resolves.toEqual([])
      await expect(search('   ', 10)).resolves.toEqual([])
    })

    it('sends a SEARCH message with the trimmed query', () => {
      const { search } = useSearchIndex()
      void search('  Brad Pitt  ', 10)
      const msg = _mock.postMessage.mock.calls[0]?.[0] as SearchWorkerIn
      expect(msg.type).toBe('SEARCH')
      expect((msg as Extract<SearchWorkerIn, { type: 'SEARCH' }>).query).toBe('Brad Pitt')
    })

    it('sends limit and optional classIris in the message', () => {
      const { search } = useSearchIndex()
      void search('actor', 5, ['http://dbpedia.org/ontology/Actor'])
      const msg = _mock.postMessage.mock.calls[0]?.[0] as Extract<
        SearchWorkerIn,
        { type: 'SEARCH' }
      >
      expect(msg.limit).toBe(5)
      expect(msg.classIris).toEqual(['http://dbpedia.org/ontology/Actor'])
    })

    it('resolves with the results delivered by the worker', async () => {
      const { search } = useSearchIndex()
      const entities = [makeScoredEntity('http://e.org/A')]

      const promise = search('test', 10)
      const sentMsg = _mock.postMessage.mock.calls[0]?.[0] as Extract<
        SearchWorkerIn,
        { type: 'SEARCH' }
      >
      _mock.respond({ type: 'RESULTS', id: sentMsg.id, results: entities })

      const results = await promise
      expect(results).toHaveLength(1)
      expect(results[0]?.iri).toBe('http://e.org/A')
    })

    it('routes concurrent searches to the correct resolver by id', async () => {
      const { search } = useSearchIndex()
      const p1 = search('alpha', 10)
      const p2 = search('beta', 10)

      const calls = _mock.postMessage.mock.calls
      const msg1 = calls[0]?.[0] as Extract<SearchWorkerIn, { type: 'SEARCH' }>
      const msg2 = calls[1]?.[0] as Extract<SearchWorkerIn, { type: 'SEARCH' }>
      expect(msg1.id).not.toBe(msg2.id)

      // Respond to second search first
      _mock.respond({ type: 'RESULTS', id: msg2.id, results: [makeScoredEntity('http://e.org/Beta')] })
      _mock.respond({ type: 'RESULTS', id: msg1.id, results: [makeScoredEntity('http://e.org/Alpha')] })

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1[0]?.iri).toBe('http://e.org/Alpha')
      expect(r2[0]?.iri).toBe('http://e.org/Beta')
    })
  })

  describe('add()', () => {
    it('sends an ADD message with the entities', () => {
      const { add } = useSearchIndex()
      const entities = [makeCachedEntity('http://e.org/A')]
      add(entities)
      const msg = _mock.postMessage.mock.calls[0]?.[0] as Extract<SearchWorkerIn, { type: 'ADD' }>
      expect(msg.type).toBe('ADD')
      expect(msg.entities).toHaveLength(1)
      expect(msg.entities[0]?.iri).toBe('http://e.org/A')
    })

    it('is a no-op for an empty array', () => {
      const { add } = useSearchIndex()
      add([])
      expect(_mock.postMessage).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('sends a REMOVE message with the given IRIs', () => {
      const { remove } = useSearchIndex()
      remove(['http://e.org/A', 'http://e.org/B'])
      const msg = _mock.postMessage.mock.calls[0]?.[0] as Extract<
        SearchWorkerIn,
        { type: 'REMOVE' }
      >
      expect(msg.type).toBe('REMOVE')
      expect(msg.iris).toEqual(['http://e.org/A', 'http://e.org/B'])
    })

    it('is a no-op for an empty array', () => {
      const { remove } = useSearchIndex()
      remove([])
      expect(_mock.postMessage).not.toHaveBeenCalled()
    })
  })

  describe('clear()', () => {
    it('sends a CLEAR message', () => {
      const { clear } = useSearchIndex()
      clear()
      const msg = _mock.postMessage.mock.calls[0]?.[0] as SearchWorkerIn
      expect(msg.type).toBe('CLEAR')
    })
  })

  describe('singleton behaviour', () => {
    it('reuses the same Worker across multiple useSearchIndex() calls', () => {
      useSearchIndex().add([makeCachedEntity('http://e.org/A')])
      useSearchIndex().add([makeCachedEntity('http://e.org/B')])
      // Both calls go to the same worker — postMessage called twice on one mock
      expect(_mock.postMessage).toHaveBeenCalledTimes(2)
    })
  })
})
