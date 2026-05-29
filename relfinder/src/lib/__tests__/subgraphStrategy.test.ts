// @vitest-environment node

/**
 * Unit tests for subgraphStrategy.
 *
 * Three user-facing scenarios drive the strategy choice at connect time:
 *
 *   Small endpoint (≤ 50 000 triples):
 *     probeTripleCount returns a real count → fetchFullGraph downloads the
 *     entire graph into a local N3 Store → all path-finding runs locally.
 *
 *   Large endpoint (e.g. DBpedia):
 *     probeTripleCount returns a large count → no full-graph fetch →
 *     fetchNeighbourhoodStore fires at path-find time, fetching only the
 *     2-hop subgraph around the two selected entities.
 *
 *   Unreachable / COUNT-unsupported endpoint:
 *     probeTripleCount catches the error and returns Infinity → caller
 *     treats it as "large" and uses the neighbourhood strategy safely.
 *
 * executeSelect and executeConstruct are mocked; no network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataFactory } from 'n3'
import type { Quad } from 'n3'
import {
  probeTripleCount,
  fetchFullGraph,
  fetchNeighbourhoodStore,
  SMALL_GRAPH_LIMIT,
} from '@/lib/sparql/subgraphStrategy'
import { executeSelect, executeConstruct } from '@/lib/sparql/engine'
import { SparqlClient } from '@/lib/sparql/client'

vi.mock('@/lib/sparql/engine', () => {
  const executeSelect = vi.fn()
  const executeSelectOnStore = vi.fn().mockResolvedValue([])
  const executeConstruct = vi.fn()
  const runSelect = vi.fn((q: string, ctx: unknown, store?: unknown, signal?: unknown) =>
    store ? executeSelectOnStore(q, store, signal) : executeSelect(q, ctx, signal),
  )
  return { executeSelect, executeSelectOnStore, executeConstruct, runSelect }
})

const { namedNode, quad, defaultGraph } = DataFactory

const CONTEXT = { endpointUrl: 'https://example.org/sparql' }
const CLIENT = new SparqlClient(CONTEXT)

function makeQuad(s: string, p: string, o: string): Quad {
  return quad(namedNode(s), namedNode(p), namedNode(o), defaultGraph())
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── probeTripleCount ──────────────────────────────────────────────────────────

describe('probeTripleCount', () => {
  it('small endpoint: returns count below threshold so full graph is fetched', async () => {
    vi.mocked(executeSelect).mockResolvedValue([{ n: { value: '3500', type: 'Literal' } }])

    const count = await probeTripleCount(CLIENT)

    expect(count).toBe(3500)
    expect(count).toBeLessThanOrEqual(SMALL_GRAPH_LIMIT)
  })

  it('large endpoint (DBpedia): returns count above threshold so neighbourhood strategy is used', async () => {
    vi.mocked(executeSelect).mockResolvedValue([{ n: { value: '500000000', type: 'Literal' } }])

    const count = await probeTripleCount(CLIENT)

    expect(count).toBe(500_000_000)
    expect(count).toBeGreaterThan(SMALL_GRAPH_LIMIT)
  })

  it('unreachable endpoint: returns Infinity so path finding still works via neighbourhood fetch', async () => {
    vi.mocked(executeSelect).mockRejectedValue(new Error('fetch failed'))

    const count = await probeTripleCount(CLIENT)

    expect(count).toBe(Infinity)
  })

  it('endpoint that does not support COUNT(*): empty result treated as Infinity', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    const count = await probeTripleCount(CLIENT)

    expect(count).toBe(Infinity)
  })

  it('malformed COUNT result (non-numeric string): treated as Infinity', async () => {
    vi.mocked(executeSelect).mockResolvedValue([{ n: { value: 'unknown', type: 'Literal' } }])

    const count = await probeTripleCount(CLIENT)

    expect(count).toBe(Infinity)
  })

  it('user disconnects mid-probe: abort causes Infinity so UI does not hang', async () => {
    vi.mocked(executeSelect).mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    )
    const controller = new AbortController()
    controller.abort()

    const count = await probeTripleCount(CLIENT, controller.signal)

    expect(count).toBe(Infinity)
  })
})

// ── fetchFullGraph ────────────────────────────────────────────────────────────

describe('fetchFullGraph', () => {
  it('populates a local store with all triples from the endpoint', async () => {
    const quads = [
      makeQuad(
        'http://example.org/Alice',
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        'http://example.org/Person',
      ),
      makeQuad('http://example.org/Alice', 'http://example.org/knows', 'http://example.org/Bob'),
      makeQuad(
        'http://example.org/Bob',
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        'http://example.org/Person',
      ),
    ]
    vi.mocked(executeConstruct).mockResolvedValue(quads)

    const store = await fetchFullGraph(CLIENT)

    expect(store.size).toBe(3)
  })

  it('returns an empty store when the endpoint has no data', async () => {
    vi.mocked(executeConstruct).mockResolvedValue([])

    const store = await fetchFullGraph(CLIENT)

    expect(store.size).toBe(0)
  })
})

// ── fetchNeighbourhoodStore ───────────────────────────────────────────────────

describe('fetchNeighbourhoodStore', () => {
  it('merges both entities neighbourhoods into one store ready for path finding', async () => {
    // Cillian Murphy and Christopher Nolan are both connected to the film Oppenheimer
    const murphyQuads = [
      makeQuad(
        'http://dbpedia.org/resource/Cillian_Murphy',
        'http://dbpedia.org/ontology/film',
        'http://dbpedia.org/resource/Oppenheimer',
      ),
    ]
    const nolanQuads = [
      makeQuad(
        'http://dbpedia.org/resource/Christopher_Nolan',
        'http://dbpedia.org/ontology/directed',
        'http://dbpedia.org/resource/Oppenheimer',
      ),
    ]

    vi.mocked(executeConstruct).mockResolvedValueOnce(murphyQuads).mockResolvedValueOnce(nolanQuads)

    const store = await fetchNeighbourhoodStore(
      'http://dbpedia.org/resource/Cillian_Murphy',
      'http://dbpedia.org/resource/Christopher_Nolan',
      CLIENT,
    )

    expect(store.size).toBe(2)
    expect(executeConstruct).toHaveBeenCalledTimes(2)
  })

  it('fetches both neighbourhoods in parallel — two CONSTRUCT queries fire', async () => {
    vi.mocked(executeConstruct).mockResolvedValue([])

    await fetchNeighbourhoodStore(
      'http://dbpedia.org/resource/Albert_Einstein',
      'http://dbpedia.org/resource/Niels_Bohr',
      CLIENT,
    )

    // Both IRIs appear in the respective query strings
    expect(executeConstruct).toHaveBeenCalledWith(
      expect.stringContaining('http://dbpedia.org/resource/Albert_Einstein'),
      expect.anything(),
      undefined,
    )
    expect(executeConstruct).toHaveBeenCalledWith(
      expect.stringContaining('http://dbpedia.org/resource/Niels_Bohr'),
      expect.anything(),
      undefined,
    )
  })

  it('deduplicates triples that appear in both neighbourhoods', async () => {
    // The shared film node appears in both entities 2-hop neighbourhood
    const sharedTriple = makeQuad(
      'http://dbpedia.org/resource/Cillian_Murphy',
      'http://dbpedia.org/ontology/film',
      'http://dbpedia.org/resource/Oppenheimer',
    )

    vi.mocked(executeConstruct)
      .mockResolvedValueOnce([sharedTriple])
      .mockResolvedValueOnce([sharedTriple])

    const store = await fetchNeighbourhoodStore(
      'http://dbpedia.org/resource/Cillian_Murphy',
      'http://dbpedia.org/resource/Christopher_Nolan',
      CLIENT,
    )

    expect(store.size).toBe(1)
  })

  it('works when one entity has no neighbours — store still contains the other half', async () => {
    const aliceQuads = [
      makeQuad('http://example.org/Alice', 'http://example.org/knows', 'http://example.org/Bob'),
    ]

    vi.mocked(executeConstruct).mockResolvedValueOnce(aliceQuads).mockResolvedValueOnce([]) // Bob is isolated

    const store = await fetchNeighbourhoodStore(
      'http://example.org/Alice',
      'http://example.org/Bob',
      CLIENT,
    )

    expect(store.size).toBe(1)
  })
})
