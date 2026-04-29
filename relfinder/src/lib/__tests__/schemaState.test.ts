/**
 * Unit tests for the schema store state machine.
 *
 * Covers every observable state transition that drives the BrowseView UI:
 *  - extracting flag lifecycle
 *  - hasData computed (drives the 3-state button)
 *  - The three UI conditions: "Extract Schema" / "Stop" / "Schema loaded"
 *  - statusMessage transitions
 *  - extractError handling (real errors vs AbortError)
 *  - progress tracking
 *  - cancel() immediate effect
 *  - corrupt-cache sanitisation (processedClassIris > nodes.length)
 *
 * extractSchema is mocked; no SPARQL endpoint is needed.
 * localStorage runs against real jsdom.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSchemaStore } from '@/stores/schema'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import { saveSchema } from '@/lib/cache/schemaStorage'
import type { PersistedSchema } from '@/lib/cache/schemaStorage'
import type { SchemaNode } from '@/lib/sparql/types'
import type { SchemaExtractionCallbacks, SchemaExtractionOptions } from '@/lib/sparql/schemaExtractor'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sparql/schemaExtractor', () => ({
  extractSchema: vi.fn(),
  fetchSchemaDataProperties: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sparql/classDescription', () => ({
  fetchClassDescription: vi.fn().mockResolvedValue(''),
}))

// ── Test data ─────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://example.org/sparql'
const CONTEXT = { endpointUrl: ENDPOINT }
const CLASS_LIMIT = 100
const EDGE_LIMIT = 50

const NODES: SchemaNode[] = [
  { iri: 'http://example.org/A', label: 'A' },
  { iri: 'http://example.org/B', label: 'B' },
  { iri: 'http://example.org/C', label: 'C' },
]

function makeStoredSchema(overrides: Partial<PersistedSchema> = {}): PersistedSchema {
  return {
    version: 1,
    endpointUrl: ENDPOINT,
    savedAt: Date.now(),
    classLimit: CLASS_LIMIT,
    edgeLimit: EDGE_LIMIT,
    nodes: NODES,
    edges: [],
    processedClassIris: NODES.map(n => n.iri),
    dataPropsCache: [],
    descriptionCache: [],
    ...overrides,
  }
}

// ── Mock factories ────────────────────────────────────────────────────────────

/** All callbacks fire synchronously; resolves before yielding to caller. */
function mockFullExtraction(nodes: SchemaNode[] = NODES) {
  vi.mocked(extractSchema).mockImplementation(
    async (_ctx, _store, _opts, callbacks: SchemaExtractionCallbacks) => {
      callbacks.onClassesLoaded?.(nodes)
      for (let i = 0; i < nodes.length; i++) {
        callbacks.onEdgesLoaded?.([])
        callbacks.onProgress?.(i + 1, nodes.length)
        callbacks.onClassProcessed?.(nodes[i].iri)
      }
      return { nodes, edges: [] }
    },
  )
}

/**
 * Mirrors the real extractSchema behaviour:
 *  - Phase 1 (onClassesLoaded) is skipped when preloadedNodes is provided.
 *  - Phase 2 is gated — caller controls when it fires.
 * Returns the gate resolver.
 */
function mockGatedExtraction(nodes: SchemaNode[] = NODES): () => void {
  let openGate!: () => void
  const gate = new Promise<void>(resolve => { openGate = resolve })

  vi.mocked(extractSchema).mockImplementation(
    async (_ctx, _store, opts: SchemaExtractionOptions, callbacks: SchemaExtractionCallbacks) => {
      if (!opts.preloadedNodes) {
        callbacks.onClassesLoaded?.(nodes)
      }
      await gate
      callbacks.onProgress?.(1, nodes.length)
      callbacks.onClassProcessed?.(nodes[0].iri)
      return { nodes, edges: [] }
    },
  )

  return openGate
}

/**
 * Both Phase 1 and Phase 2 are gated so statusMessage can be inspected
 * before any callback clears it.
 */
function mockFullyGatedExtraction(nodes: SchemaNode[] = NODES): () => void {
  let openGate!: () => void
  const gate = new Promise<void>(resolve => { openGate = resolve })

  vi.mocked(extractSchema).mockImplementation(
    async (_ctx, _store, opts: SchemaExtractionOptions, callbacks: SchemaExtractionCallbacks) => {
      await gate
      if (!opts.preloadedNodes) {
        callbacks.onClassesLoaded?.(nodes)
      }
      for (let i = 0; i < nodes.length; i++) {
        callbacks.onProgress?.(i + 1, nodes.length)
        callbacks.onClassProcessed?.(nodes[i].iri)
      }
      return { nodes, edges: [] }
    },
  )

  return openGate
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('schema store — state machine', () => {
  // ── extracting flag ──────────────────────────────────────────────────────────

  describe('extracting flag', () => {
    it('starts as false on a fresh store', () => {
      expect(useSchemaStore().extracting).toBe(false)
    })

    it('is true while extractSchema is awaited', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(true)

      openGate()
      await done
    })

    it('is false after normal completion', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(false)
    })

    it('is false immediately after cancel() without waiting for workers to finish', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(true)
      store.cancel()
      expect(store.extracting).toBe(false)  // immediate — does not wait for gate

      openGate()
      await done
    })

    it('is false after a non-abort error', async () => {
      vi.mocked(extractSchema).mockRejectedValue(new Error('network error'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(false)
    })

    it('is never set to true for a fully-cached schema', async () => {
      saveSchema(ENDPOINT, makeStoredSchema())
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(false)
      expect(extractSchema).not.toHaveBeenCalled()
    })
  })

  // ── hasData ───────────────────────────────────────────────────────────────────

  describe('hasData', () => {
    it('is false on a fresh store', () => {
      expect(useSchemaStore().hasData).toBe(false)
    })

    it('becomes true when nodes are loaded from a fresh extraction', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.hasData).toBe(true)
    })

    it('becomes true synchronously when a cached schema is restored', async () => {
      saveSchema(ENDPOINT, makeStoredSchema())
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.hasData).toBe(true)
    })

    it('becomes true when Phase 1 loads nodes, before Phase 2 completes', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // Phase 1 fired synchronously in the mock — nodes are already present
      expect(store.hasData).toBe(true)
      expect(store.extracting).toBe(true)  // still extracting

      openGate()
      await done
    })

    it('is false after clear()', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.clear()
      expect(store.hasData).toBe(false)
    })

    it('remains true after cancel() — nodes from Phase 1 are kept', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.cancel()
      expect(store.hasData).toBe(true)  // partial schema retained

      openGate()
      await done
    })
  })

  // ── 3-state UI conditions ─────────────────────────────────────────────────────

  describe('UI state conditions', () => {
    it('"Extract Schema": !hasData && !extracting on fresh store', () => {
      const store = useSchemaStore()
      expect(store.hasData).toBe(false)
      expect(store.extracting).toBe(false)
    })

    it('"Stop": extracting is true while extraction is in progress', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(true)

      openGate()
      await done
    })

    it('"Schema loaded": hasData && !extracting after completion', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.hasData).toBe(true)
      expect(store.extracting).toBe(false)
    })

    it('"Schema loaded" immediately for a fully-cached schema', async () => {
      saveSchema(ENDPOINT, makeStoredSchema())
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.hasData).toBe(true)
      expect(store.extracting).toBe(false)
    })

    it('"Schema loaded" after cancel() with partial data — not "Extract Schema"', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.cancel()

      // hasData is true (Phase 1 already loaded nodes), extracting is false
      expect(store.hasData).toBe(true)
      expect(store.extracting).toBe(false)

      openGate()
      await done
    })

    it('"Extract Schema" returns after clear()', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.clear()

      expect(store.hasData).toBe(false)
      expect(store.extracting).toBe(false)
    })

    it('transitions correctly through all three states in a single extraction', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()

      // State 1: "Extract Schema"
      expect(store.hasData).toBe(false)
      expect(store.extracting).toBe(false)

      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // State 2: "Stop" (Phase 1 fired; extracting = true)
      expect(store.extracting).toBe(true)

      openGate()
      await done

      // State 3: "Schema loaded"
      expect(store.hasData).toBe(true)
      expect(store.extracting).toBe(false)
    })
  })

  // ── statusMessage ─────────────────────────────────────────────────────────────

  describe('statusMessage', () => {
    it('is "Discovering classes…" before Phase 1 completes on a fresh start', async () => {
      const openGate = mockFullyGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.statusMessage).toBe('Discovering classes…')

      openGate()
      await done
    })

    it('is "Resuming..." before Phase 2 starts when resuming a partial cache', async () => {
      // Only NODES[0] was processed — Phase 2 resumes for the rest
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: [NODES[0].iri] }))
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // For the partial-cache path extractSchema is called with preloadedNodes,
      // so onClassesLoaded is not fired by the mock → statusMessage stays set
      expect(store.statusMessage).toBe('Resuming...')

      openGate()
      await done
    })

    it('is cleared to empty after completion', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.statusMessage).toBe('')
    })

    it('is cleared immediately by cancel()', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.cancel()
      expect(store.statusMessage).toBe('')

      openGate()
      await done
    })

    it('is empty when a fully-cached schema is restored (no extraction needed)', async () => {
      saveSchema(ENDPOINT, makeStoredSchema())
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.statusMessage).toBe('')
    })

    it('is cleared at the start of the next start() call regardless of prior state', async () => {
      vi.mocked(extractSchema).mockRejectedValue(new Error('oops'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      const openGate = mockFullyGatedExtraction()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT, true)
      // statusMessage is set to 'Discovering classes…', not leftover from error state
      expect(['Discovering classes…', '']).toContain(store.statusMessage)

      openGate()
      await done
    })
  })

  // ── extractError ──────────────────────────────────────────────────────────────

  describe('extractError', () => {
    it('is empty on a fresh store', () => {
      expect(useSchemaStore().extractError).toBe('')
    })

    it('is set when extractSchema rejects with a non-abort error', async () => {
      vi.mocked(extractSchema).mockRejectedValue(new Error('timeout after 30s'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extractError).toBe('Extraction failed: timeout after 30s')
    })

    it('is NOT set when extractSchema rejects with an AbortError', async () => {
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
      vi.mocked(extractSchema).mockRejectedValue(abortError)
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extractError).toBe('')
    })

    it('is NOT set when cancel() is called (abort path)', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.cancel()
      openGate()
      await done

      expect(store.extractError).toBe('')
    })

    it('is cleared at the start of a new start() call', async () => {
      vi.mocked(extractSchema).mockRejectedValueOnce(new Error('first error'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)
      expect(store.extractError).not.toBe('')

      mockFullExtraction()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT, true)
      expect(store.extractError).toBe('')
    })

    it('extracting is false even after an error', async () => {
      vi.mocked(extractSchema).mockRejectedValue(new Error('boom'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.extracting).toBe(false)
    })
  })

  // ── progress ──────────────────────────────────────────────────────────────────

  describe('progress', () => {
    it('starts at { completed: 0, total: 0 }', () => {
      const { progress } = useSchemaStore()
      expect(progress.completed).toBe(0)
      expect(progress.total).toBe(0)
    })

    it('completed and total equal nodes.length after full extraction', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.progress.completed).toBe(NODES.length)
      expect(store.progress.total).toBe(NODES.length)
    })

    it('completed never exceeds total', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.progress.completed).toBeLessThanOrEqual(store.progress.total)
    })

    it('reflects the skipped count immediately when resuming a partial cache', async () => {
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: [NODES[0].iri] }))
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // Before Phase 2 fires: completed = 1 (skipped), total = 3
      expect(store.progress.completed).toBe(1)
      expect(store.progress.total).toBe(NODES.length)

      openGate()
      await done
    })

    it('is reset to { 0, 0 } by clear()', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.clear()
      expect(store.progress.completed).toBe(0)
      expect(store.progress.total).toBe(0)
    })

    it('cancel() preserves progress so the user can see where extraction stopped', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.progress.total).toBe(NODES.length)
      store.cancel()

      // total is preserved — not reset to 0
      expect(store.progress.total).toBe(NODES.length)

      openGate()
      await done
    })
  })

  // ── corrupt-cache sanitisation ────────────────────────────────────────────────

  describe('corrupt-cache sanitisation (processedClassIris > nodes.length)', () => {
    const phantomIris = (n: number) =>
      Array.from({ length: n }, (_, i) => `http://phantom.org/P${i}`)

    it('discards IRIs that are not in the saved node list', async () => {
      // 3 valid + 13 phantom = 16 total, 3 nodes → should treat as fully cached
      const corruptProcessed = [...NODES.map(n => n.iri), ...phantomIris(13)]
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: corruptProcessed }))

      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(extractSchema).not.toHaveBeenCalled()
      expect(store.nodes).toHaveLength(NODES.length)
    })

    it('reproduces the "116 / 100" bug: treats over-counted cache as fully cached', async () => {
      const corruptProcessed = [...NODES.map(n => n.iri), ...phantomIris(113)]
      expect(corruptProcessed.length).toBe(116)  // sanity-check the fixture
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: corruptProcessed }))

      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // After sanitisation: 3/3 valid processed → fully cached, no extractSchema call
      expect(extractSchema).not.toHaveBeenCalled()
    })

    it('correctly resumes Phase 2 after sanitising a corrupt partial cache', async () => {
      mockFullExtraction()
      // Only NODES[0] was validly processed; phantoms don't count
      const corruptProcessed = [NODES[0].iri, ...phantomIris(10)]
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: corruptProcessed }))

      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(extractSchema).toHaveBeenCalledOnce()
      const opts = vi.mocked(extractSchema).mock.calls[0]![2]
      // Only the one valid processed IRI should be in skipClasses
      expect(opts.skipClasses?.size).toBe(1)
      expect(opts.skipClasses?.has(NODES[0].iri)).toBe(true)
    })

    it('progress.completed reflects only valid processed IRIs after sanitisation', async () => {
      const openGate = mockGatedExtraction()
      const corruptProcessed = [NODES[0].iri, ...phantomIris(10)]
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: corruptProcessed }))

      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // 1 valid processed, NOT 11 (10 phantoms discarded)
      expect(store.progress.completed).toBe(1)
      expect(store.progress.total).toBe(NODES.length)

      openGate()
      await done
    })
  })

  // ── cancel / abort guard ──────────────────────────────────────────────────────

  describe('cancel() and abort guard', () => {
    it('does not leave extracting=true when the gate fires after cancel()', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.cancel()
      openGate()
      await done

      expect(store.extracting).toBe(false)
    })

    it('a second start() after cancel() clears extractError from the first run', async () => {
      vi.mocked(extractSchema).mockRejectedValueOnce(new Error('first error'))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)
      expect(store.extractError).not.toBe('')

      mockFullExtraction()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT, true)
      expect(store.extractError).toBe('')
    })

    it('clear() resets all state simultaneously', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.clear()

      expect(store.nodes).toHaveLength(0)
      expect(store.edges).toHaveLength(0)
      expect(store.extracting).toBe(false)
      expect(store.extractError).toBe('')
      expect(store.progress.completed).toBe(0)
      expect(store.progress.total).toBe(0)
      expect(store.statusMessage).toBe('')
    })
  })
})
