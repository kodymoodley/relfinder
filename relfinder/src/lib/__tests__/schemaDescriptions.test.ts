/**
 * Unit tests for Phase 1 description fetching in extractSchema.
 *
 * Covers:
 *  - onDescriptionsLoaded callback invocation and content
 *  - Empty-string entries for classes with no description found
 *  - Language priority: preferred → 'en' → untagged → first available
 *  - Graceful degradation when the description query fails
 *  - Callback is NOT fired when using preloadedNodes (resumed extraction)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import { executeSelect } from '@/lib/sparql/engine'
import type { SparqlBinding } from '@/lib/sparql/types'
import type { SchemaExtractionCallbacks } from '@/lib/sparql/schemaExtractor'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sparql/engine', () => {
  const executeSelect = vi.fn()
  const executeSelectOnStore = vi.fn().mockResolvedValue([])
  const runSelect = vi.fn((q: string, ctx: unknown, store?: unknown) =>
    store ? executeSelectOnStore(q, store) : executeSelect(q, ctx),
  )
  return { executeSelect, executeSelectOnStore, runSelect }
})

vi.mock('@/lib/sparql/entitySearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sparql/entitySearch')>()
  return { ...actual, fetchLabels: vi.fn().mockResolvedValue(new Map()) }
})

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTEXT = { endpointUrl: 'https://example.org/sparql' }
const CLASS_A = 'http://example.org/A'
const CLASS_B = 'http://example.org/B'
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment'

// ── Row builders ──────────────────────────────────────────────────────────────

const classDiscoveryRow = (iri: string): SparqlBinding => ({
  class: { value: iri, type: 'uri' },
})

const descriptionRow = (classIri: string, text: string, lang: string): SparqlBinding => ({
  class: { value: classIri, type: 'uri' },
  prop: { value: RDFS_COMMENT, type: 'uri' },
  val: { value: text, type: 'Literal', lang },
})

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Route executeSelect calls by query content:
 *  - DISTINCT  → Phase 1 class discovery
 *  - VALUES ?prop → description batch
 *  - else         → Phase 2 edge queries (empty)
 */
function routeSelect(discoveryRows: SparqlBinding[], descRows: SparqlBinding[]) {
  vi.mocked(executeSelect).mockImplementation(async (query: string) => {
    if (query.includes('DISTINCT')) return discoveryRows
    if (query.includes('VALUES ?prop')) return descRows
    return []
  })
}

function makeCallbacks(): SchemaExtractionCallbacks {
  return {
    onClassesLoaded: vi.fn(),
    onEdgesLoaded: vi.fn(),
    onProgress: vi.fn(),
    onClassProcessed: vi.fn(),
    onDescriptionsLoaded: vi.fn(),
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractSchema — Phase 1 description fetching', () => {
  // ── onDescriptionsLoaded callback ─────────────────────────────────────────

  describe('onDescriptionsLoaded callback', () => {
    it('is called when descriptions are returned by the endpoint', async () => {
      routeSelect([classDiscoveryRow(CLASS_A)], [descriptionRow(CLASS_A, 'A class', 'en')])
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      expect(cbs.onDescriptionsLoaded).toHaveBeenCalled()
    })

    it('passes a Map with the description text for matching classes', async () => {
      routeSelect([classDiscoveryRow(CLASS_A)], [descriptionRow(CLASS_A, 'A class', 'en')])
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.get(CLASS_A)).toBe('A class')
    })

    it('includes an empty-string entry for classes with no description', async () => {
      routeSelect(
        [classDiscoveryRow(CLASS_A), classDiscoveryRow(CLASS_B)],
        [descriptionRow(CLASS_A, 'Only A has one', 'en')],
      )
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.has(CLASS_B)).toBe(true)
      expect(map.get(CLASS_B)).toBe('')
    })

    it('is NOT called when extraction uses preloadedNodes (Phase 1 skipped)', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const cbs = makeCallbacks()
      await extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: [{ iri: CLASS_A, label: 'A' }] },
        cbs,
      )

      expect(cbs.onDescriptionsLoaded).not.toHaveBeenCalled()
    })

    it('is called once per batch of 20 classes', async () => {
      // 21 classes → 2 batches of 20 and 1
      const iris = Array.from({ length: 21 }, (_, i) => `http://example.org/C${i}`)
      routeSelect(iris.map(classDiscoveryRow), [])
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      // Two batches → two onDescriptionsLoaded calls
      expect(cbs.onDescriptionsLoaded).toHaveBeenCalledTimes(2)
    })
  })

  // ── Language priority ──────────────────────────────────────────────────────

  describe('language priority', () => {
    it('selects the configured language when available', async () => {
      routeSelect(
        [classDiscoveryRow(CLASS_A)],
        [descriptionRow(CLASS_A, 'In English', 'en'), descriptionRow(CLASS_A, 'Auf Deutsch', 'de')],
      )
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { language: 'de' }, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.get(CLASS_A)).toBe('Auf Deutsch')
    })

    it('falls back to English when the preferred language is absent', async () => {
      routeSelect(
        [classDiscoveryRow(CLASS_A)],
        [descriptionRow(CLASS_A, 'In English', 'en'), descriptionRow(CLASS_A, 'Untagged', '')],
      )
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { language: 'fr' }, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.get(CLASS_A)).toBe('In English')
    })

    it('falls back to untagged when neither preferred nor English is available', async () => {
      routeSelect([classDiscoveryRow(CLASS_A)], [descriptionRow(CLASS_A, 'Untagged', '')])
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { language: 'fr' }, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.get(CLASS_A)).toBe('Untagged')
    })

    it('falls back to any available language as a last resort', async () => {
      routeSelect([classDiscoveryRow(CLASS_A)], [descriptionRow(CLASS_A, 'Auf Deutsch', 'de')])
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { language: 'fr' }, cbs)

      const [map] = vi.mocked(cbs.onDescriptionsLoaded!).mock.calls[0]!
      expect(map.get(CLASS_A)).toBe('Auf Deutsch')
    })
  })

  // ── Resilience ─────────────────────────────────────────────────────────────

  describe('resilience', () => {
    it('description fetch failure does not prevent onClassesLoaded from firing', async () => {
      vi.mocked(executeSelect).mockImplementation(async (query: string) => {
        if (query.includes('DISTINCT')) return [classDiscoveryRow(CLASS_A)]
        if (query.includes('VALUES ?prop')) throw new Error('endpoint error')
        return []
      })
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      expect(cbs.onClassesLoaded).toHaveBeenCalledOnce()
    })

    it('extraction returns correctly when all description queries return empty', async () => {
      routeSelect([classDiscoveryRow(CLASS_A), classDiscoveryRow(CLASS_B)], [])
      const cbs = makeCallbacks()
      const result = await extractSchema(CONTEXT, undefined, {}, cbs)

      expect(result.nodes).toHaveLength(2)
      expect(cbs.onClassesLoaded).toHaveBeenCalledOnce()
    })

    it('Phase 2 edge queries still run after a description fetch failure', async () => {
      const edgeRow: SparqlBinding = {
        prop: { value: 'http://example.org/rel', type: 'NamedNode' },
        c2: { value: CLASS_B, type: 'NamedNode' },
        n: { value: '3', type: 'Literal' },
      }
      vi.mocked(executeSelect).mockImplementation(async (query: string) => {
        if (query.includes('DISTINCT'))
          return [classDiscoveryRow(CLASS_A), classDiscoveryRow(CLASS_B)]
        if (query.includes('VALUES ?prop')) throw new Error('description error')
        // Phase 2: class A has an edge to B
        if (query.includes(`<${CLASS_A}>`)) return [edgeRow]
        return []
      })
      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, {}, cbs)

      expect(cbs.onEdgesLoaded).toHaveBeenCalled()
    })
  })
})
