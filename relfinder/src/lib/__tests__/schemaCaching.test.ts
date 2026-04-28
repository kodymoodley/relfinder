/**
 * Integration tests for schema store caching behaviour.
 *
 * These tests verify that:
 *  - start() restores fully- and partially-cached schemas from localStorage
 *  - start() persists to localStorage at the right lifecycle points
 *  - clear() + subsequent async callbacks do not corrupt stored data
 *  - force=true bypasses the cache
 *
 * extractSchema is mocked so tests run without a SPARQL endpoint.
 * loadSchema / saveSchema run against the real jsdom localStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSchemaStore } from '@/stores/schema'
import { loadSchema, saveSchema } from '@/lib/cache/schemaStorage'
import type { PersistedSchema } from '@/lib/cache/schemaStorage'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import type { SchemaNode } from '@/lib/sparql/types'
import type { SchemaExtractionCallbacks } from '@/lib/sparql/schemaExtractor'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sparql/schemaExtractor', () => ({
  extractSchema: vi.fn(),
  fetchSchemaDataProperties: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sparql/classDescription', () => ({
  fetchClassDescription: vi.fn().mockResolvedValue(''),
}))

// ── Test data ──────────────────────────────────────────────────────────────────

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
    processedClassIris: NODES.map(n => n.iri),   // all processed = fully cached
    dataPropsCache: [],
    descriptionCache: [],
    ...overrides,
  }
}

// ── Mock factory helpers ───────────────────────────────────────────────────────

/**
 * Makes extractSchema call all callbacks synchronously in the same microtask
 * as the caller, completing Phase 1 + all of Phase 2 before yielding.
 */
function mockFullExtraction(nodes: SchemaNode[] = NODES) {
  vi.mocked(extractSchema).mockImplementation(async (_ctx, _store, _opts, callbacks: SchemaExtractionCallbacks) => {
    callbacks.onClassesLoaded?.(nodes)
    for (let i = 0; i < nodes.length; i++) {
      callbacks.onEdgesLoaded?.([])
      callbacks.onProgress?.(i + 1, nodes.length)
      callbacks.onClassProcessed?.(nodes[i].iri)
    }
    return { nodes, edges: [] }
  })
}

/**
 * Splits extraction into two phases controlled by a promise gate.
 * Phase 1 (onClassesLoaded) runs synchronously before the gate.
 * Phase 2 (onClassProcessed for the first node) runs after the gate resolves.
 * Returns the gate resolver so tests can control when Phase 2 fires.
 */
function mockGatedExtraction(nodes: SchemaNode[] = NODES): () => void {
  let openGate!: () => void
  const gate = new Promise<void>(resolve => { openGate = resolve })

  vi.mocked(extractSchema).mockImplementation(async (_ctx, _store, _opts, callbacks: SchemaExtractionCallbacks) => {
    callbacks.onClassesLoaded?.(nodes)
    await gate
    callbacks.onProgress?.(1, nodes.length)
    callbacks.onClassProcessed?.(nodes[0].iri)
    return { nodes, edges: [] }
  })

  return openGate
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('schema store — caching', () => {
  describe('start() with no cached data', () => {
    it('runs a fresh extraction and calls extractSchema', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(extractSchema).toHaveBeenCalledOnce()
      expect(store.nodes).toHaveLength(NODES.length)
    })

    it('does not pass preloadedNodes or skipClasses on a fresh start', async () => {
      mockFullExtraction()
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      const opts = vi.mocked(extractSchema).mock.calls[0]![2]
      expect(opts.preloadedNodes).toBeUndefined()
      expect(opts.skipClasses).toBeUndefined()
    })
  })

  describe('start() with a fully-cached schema', () => {
    it('restores nodes immediately without calling extractSchema', async () => {
      saveSchema(ENDPOINT, makeStoredSchema())
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(extractSchema).not.toHaveBeenCalled()
      expect(store.nodes).toHaveLength(NODES.length)
      expect(store.nodes[0].iri).toBe(NODES[0].iri)
    })

    it('restores dataPropsCache and descriptionCache', async () => {
      saveSchema(ENDPOINT, makeStoredSchema({
        dataPropsCache: [['http://example.org/A', [{ iri: 'http://example.org/name', label: 'name', datatypes: ['xsd:string'] }]]],
        descriptionCache: [['http://example.org/A', 'A class called A']],
      }))
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(store.dataPropsCache.get('http://example.org/A')).toHaveLength(1)
      expect(store.descriptionCache.get('http://example.org/A')).toBe('A class called A')
    })

    it('ignores cache when classLimit differs', async () => {
      mockFullExtraction()
      saveSchema(ENDPOINT, makeStoredSchema({ classLimit: 50 }))  // stored with limit 50
      await useSchemaStore().start(CONTEXT, undefined, 100, EDGE_LIMIT)  // request limit 100

      expect(extractSchema).toHaveBeenCalledOnce()
    })

    it('ignores cache when edgeLimit differs', async () => {
      mockFullExtraction()
      saveSchema(ENDPOINT, makeStoredSchema({ edgeLimit: 20 }))
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, 50)

      expect(extractSchema).toHaveBeenCalledOnce()
    })
  })

  describe('start() with a partially-cached schema', () => {
    it('restores nodes and passes preloadedNodes + skipClasses to extractSchema', async () => {
      mockFullExtraction()
      // Only first node was processed
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: [NODES[0].iri] }))
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      expect(extractSchema).toHaveBeenCalledOnce()
      const opts = vi.mocked(extractSchema).mock.calls[0]![2]
      expect(opts.preloadedNodes).toHaveLength(NODES.length)
      expect(opts.skipClasses?.has(NODES[0].iri)).toBe(true)
      expect(opts.skipClasses?.has(NODES[1].iri)).toBe(false)
    })

    it('initialises progress counter at the number of already-skipped classes', async () => {
      // Use gated extraction so Phase 2 doesn't fire before we can inspect state
      const openGate = mockGatedExtraction()
      saveSchema(ENDPOINT, makeStoredSchema({ processedClassIris: [NODES[0].iri] }))
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // Phase 1 (onClassesLoaded) fired synchronously — progress.completed
      // should reflect the already-skipped class, not reset to 0
      expect(store.progress.completed).toBe(1)
      expect(store.progress.total).toBe(NODES.length)

      openGate()
      await done
    })
  })

  describe('start() with force=true', () => {
    it('ignores a valid cache and runs a full extraction', async () => {
      mockFullExtraction()
      saveSchema(ENDPOINT, makeStoredSchema())
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT, true)

      expect(extractSchema).toHaveBeenCalledOnce()
    })

    it('does not pass preloadedNodes when force=true', async () => {
      mockFullExtraction()
      saveSchema(ENDPOINT, makeStoredSchema())
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT, true)

      const opts = vi.mocked(extractSchema).mock.calls[0]![2]
      expect(opts.preloadedNodes).toBeUndefined()
    })
  })

  describe('persistence during extraction', () => {
    it('persists to localStorage after onClassesLoaded (Phase 1 complete)', async () => {
      // Phase 1 runs synchronously in the mock; Phase 2 is gated
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // At this point Phase 1 (onClassesLoaded) has already fired synchronously
      const saved = loadSchema(ENDPOINT)
      expect(saved).not.toBeNull()
      expect(saved!.nodes).toHaveLength(NODES.length)
      expect(saved!.processedClassIris).toHaveLength(0)  // no Phase 2 classes yet

      openGate()
      await done
    })

    it('persists updated processedClassIris after each onClassProcessed (Phase 2)', async () => {
      mockFullExtraction()
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      const saved = loadSchema(ENDPOINT)
      expect(saved!.processedClassIris).toHaveLength(NODES.length)
    })

    it('updates savedAt on each persist so TTL restarts from the last write', async () => {
      const before = Date.now()
      mockFullExtraction()
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      const saved = loadSchema(ENDPOINT)
      expect(saved!.savedAt).toBeGreaterThanOrEqual(before)
    })
  })

  describe('persist guard — no corrupt writes after clear()', () => {
    it('does not overwrite valid cached nodes with empty array when clear() races an in-flight callback', async () => {
      const openGate = mockGatedExtraction()
      const store = useSchemaStore()
      const done = store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // Phase 1 has completed synchronously — valid nodes are in localStorage
      const savedAfterPhase1 = loadSchema(ENDPOINT)
      expect(savedAfterPhase1!.nodes).toHaveLength(NODES.length)

      // Simulate disconnect: wipes in-memory state
      store.clear()
      expect(store.nodes).toHaveLength(0)

      // Now let the gated Phase 2 callback fire
      // (simulates an in-flight SPARQL query completing after clear())
      openGate()
      await done

      // localStorage must still hold the valid Phase 1 snapshot, not corrupted empty nodes
      const savedAfterClear = loadSchema(ENDPOINT)
      expect(savedAfterClear).not.toBeNull()
      expect(savedAfterClear!.nodes).toHaveLength(NODES.length)
    })

    it('does not persist at all when there were no nodes to begin with', async () => {
      vi.mocked(extractSchema).mockResolvedValue({ nodes: [], edges: [] })
      await useSchemaStore().start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      // Nothing meaningful to cache — localStorage should stay empty
      expect(loadSchema(ENDPOINT)).toBeNull()
    })
  })

  describe('clear()', () => {
    it('resets all in-memory state', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)
      expect(store.nodes).toHaveLength(NODES.length)

      store.clear()
      expect(store.nodes).toHaveLength(0)
      expect(store.edges).toHaveLength(0)
      expect(store.extracting).toBe(false)
      expect(store.progress.completed).toBe(0)
      expect(store.progress.total).toBe(0)
      expect(store.statusMessage).toBe('')
    })

    it('does NOT clear localStorage — cached data survives for next session', async () => {
      mockFullExtraction()
      const store = useSchemaStore()
      await store.start(CONTEXT, undefined, CLASS_LIMIT, EDGE_LIMIT)

      store.clear()
      expect(loadSchema(ENDPOINT)).not.toBeNull()
    })
  })
})
