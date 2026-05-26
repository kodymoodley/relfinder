/**
 * Unit tests for extractSchema — Phase 2 worker abort guard.
 *
 * Verifies that when the AbortSignal fires during Phase 2:
 *  - Workers do not call onProgress or onClassProcessed for in-flight requests
 *    that complete after the abort (the post-catch guard)
 *  - Workers skip the entire queue when the signal is already aborted
 *  - onEdgesLoaded is not called after abort (the pre-emit guard)
 *
 * executeSelect is mocked so no SPARQL endpoint is needed.
 * preloadedNodes is always supplied to skip Phase 1 entirely.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import { executeSelect } from '@/lib/sparql/engine'
import type { SchemaNode, SparqlBinding } from '@/lib/sparql/types'
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONTEXT = { endpointUrl: 'https://example.org/sparql' }

const NODES: SchemaNode[] = [
  { iri: 'http://example.org/A', label: 'A' },
  { iri: 'http://example.org/B', label: 'B' },
]

function makeCallbacks() {
  return {
    onClassesLoaded: vi.fn(),
    onEdgesLoaded: vi.fn(),
    onProgress: vi.fn(),
    onClassProcessed: vi.fn(),
  } satisfies SchemaExtractionCallbacks
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractSchema — Phase 2 abort guard', () => {
  describe('signal already aborted before Phase 2 starts', () => {
    it('fires no edge queries', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const controller = new AbortController()
      controller.abort()

      await extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: NODES },
        makeCallbacks(),
        controller.signal,
      )

      expect(executeSelect).not.toHaveBeenCalled()
    })

    it('calls neither onProgress nor onClassProcessed', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const controller = new AbortController()
      controller.abort()

      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { preloadedNodes: NODES }, cbs, controller.signal)

      expect(cbs.onProgress).not.toHaveBeenCalled()
      expect(cbs.onClassProcessed).not.toHaveBeenCalled()
    })

    it('calls neither onEdgesLoaded nor onClassesLoaded', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const controller = new AbortController()
      controller.abort()

      const cbs = makeCallbacks()
      await extractSchema(CONTEXT, undefined, { preloadedNodes: NODES }, cbs, controller.signal)

      expect(cbs.onEdgesLoaded).not.toHaveBeenCalled()
      expect(cbs.onClassesLoaded).not.toHaveBeenCalled()
    })
  })

  describe('signal aborted while a query is in-flight (post-catch guard)', () => {
    it('does not call onProgress for a class whose query resolved after abort', async () => {
      const controller = new AbortController()

      let resolveQuery!: () => void
      const slowQuery = new Promise<SparqlBinding[]>((resolve) => {
        resolveQuery = () => resolve([])
      })
      vi.mocked(executeSelect).mockReturnValue(slowQuery)

      const cbs = makeCallbacks()
      const done = extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: [NODES[0]!] },
        cbs,
        controller.signal,
      )

      controller.abort()
      resolveQuery()
      await done

      expect(cbs.onProgress).not.toHaveBeenCalled()
    })

    it('does not call onClassProcessed for a class whose query resolved after abort', async () => {
      const controller = new AbortController()

      let resolveQuery!: () => void
      const slowQuery = new Promise<SparqlBinding[]>((resolve) => {
        resolveQuery = () => resolve([])
      })
      vi.mocked(executeSelect).mockReturnValue(slowQuery)

      const cbs = makeCallbacks()
      const done = extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: [NODES[0]!] },
        cbs,
        controller.signal,
      )

      controller.abort()
      resolveQuery()
      await done

      expect(cbs.onClassProcessed).not.toHaveBeenCalled()
    })

    it('does not call onEdgesLoaded when edges arrive after abort', async () => {
      const controller = new AbortController()

      // Return a non-empty result so onEdgesLoaded would fire if not guarded
      const edgeRow: SparqlBinding = {
        prop: { value: 'http://example.org/rel', type: 'NamedNode' },
        c2: { value: 'http://example.org/B', type: 'NamedNode' },
        n: { value: '5', type: 'Literal' },
      }
      let resolveQuery!: (rows: SparqlBinding[]) => void
      const slowQuery = new Promise<SparqlBinding[]>((resolve) => {
        resolveQuery = resolve
      })
      vi.mocked(executeSelect).mockReturnValue(slowQuery)

      const cbs = makeCallbacks()
      const done = extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: [NODES[0]!], skipClasses: new Set([NODES[1]!.iri]) },
        cbs,
        controller.signal,
      )

      controller.abort()
      resolveQuery([edgeRow])
      await done

      expect(cbs.onEdgesLoaded).not.toHaveBeenCalled()
    })

    it('stops processing remaining queue items after the first aborted class', async () => {
      const controller = new AbortController()

      let resolveFirst!: () => void
      const firstQuery = new Promise<SparqlBinding[]>((resolve) => {
        resolveFirst = () => resolve([])
      })
      vi.mocked(executeSelect)
        .mockReturnValueOnce(firstQuery) // class A (slow)
        .mockResolvedValue([]) // class B (fast — should never be reached)

      const cbs = makeCallbacks()
      // concurrency=1 so workers run sequentially, making queue order deterministic
      const done = extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: NODES, concurrency: 1 },
        cbs,
        controller.signal,
      )

      controller.abort()
      resolveFirst()
      await done

      // Class B's query should never have been started
      expect(executeSelect).toHaveBeenCalledTimes(1)
    })
  })

  describe('normal extraction (no abort)', () => {
    it('calls onProgress and onClassProcessed for every class', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const controller = new AbortController()
      const cbs = makeCallbacks()

      await extractSchema(CONTEXT, undefined, { preloadedNodes: NODES }, cbs, controller.signal)

      expect(cbs.onProgress).toHaveBeenCalledTimes(NODES.length)
      expect(cbs.onClassProcessed).toHaveBeenCalledTimes(NODES.length)
    })

    it('calls onEdgesLoaded when edges are returned', async () => {
      const edgeRow: SparqlBinding = {
        prop: { value: 'http://example.org/rel', type: 'NamedNode' },
        c2: { value: 'http://example.org/B', type: 'NamedNode' },
        n: { value: '3', type: 'Literal' },
      }
      vi.mocked(executeSelect)
        .mockResolvedValueOnce([edgeRow]) // class A has edges
        .mockResolvedValue([]) // class B has none

      const controller = new AbortController()
      const cbs = makeCallbacks()

      await extractSchema(CONTEXT, undefined, { preloadedNodes: NODES }, cbs, controller.signal)

      expect(cbs.onEdgesLoaded).toHaveBeenCalledTimes(1)
    })

    it('skipClasses are excluded from the queue and counted in the progress offset', async () => {
      vi.mocked(executeSelect).mockResolvedValue([])
      const controller = new AbortController()
      const cbs = makeCallbacks()

      await extractSchema(
        CONTEXT,
        undefined,
        { preloadedNodes: NODES, skipClasses: new Set([NODES[0]!.iri]) },
        cbs,
        controller.signal,
      )

      // Only class B processed; progress starts at 1 (skip offset) and goes to 2
      expect(executeSelect).toHaveBeenCalledTimes(1)
      expect(cbs.onProgress).toHaveBeenCalledWith(2, NODES.length)
      expect(cbs.onClassProcessed).toHaveBeenCalledWith(NODES[1]!.iri)
      expect(cbs.onClassProcessed).not.toHaveBeenCalledWith(NODES[0]!.iri)
    })
  })
})
