// @vitest-environment node

/**
 * Unit tests for graphBuilder.ts — pure graph assembly functions.
 *
 * Focuses on the three uncovered branch areas:
 *
 *   isPropChainValid (lines 38-42)
 *     Called only when allowedObjectProperties is non-empty. Tests that
 *     multi-hop paths where all properties are in the whitelist pass, and
 *     paths with an unlisted property are rejected.
 *
 *   Single-hop edge filtering (line 201)
 *     A direct one-property path whose IRI is not in allowedObjectProperties
 *     must be silently dropped from the result graph.
 *
 *   mergeEdgeDuplicates duplicate-IRI guard (lines 249-251)
 *     When the same sid→tid IRI appears twice, the second occurrence must
 *     not be pushed into the iris array (prevents doubled labels).
 *
 * Also covers applyLabelsAndTypes and basic buildRelationshipsGraph to give
 * the file meaningful baseline coverage.
 */

import { describe, it, expect } from 'vitest'
import {
  buildRelationshipsGraph,
  mergeEdgeDuplicates,
  applyLabelsAndTypes,
} from '@/lib/sparql/graphBuilder'
import type { PathCollection, GraphEdge, GraphNode } from '@/lib/sparql/types'

const ALICE = 'http://example.org/Alice'
const BOB = 'http://example.org/Bob'
const KNOWS = 'http://example.org/knows'
const LIKES = 'http://example.org/likes'

// ── buildRelationshipsGraph — basic direct path ───────────────────────────────

describe('buildRelationshipsGraph', () => {
  it('builds a two-node graph from a single-hop direct path', () => {
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [{ pf1: { value: KNOWS, type: 'NamedNode' } }],
      },
    ]

    const { nodes, edges } = buildRelationshipsGraph(ALICE, BOB, collections)

    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.iri).toBe(KNOWS)
  })

  it('marks only src and dest nodes as endpoints', () => {
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [{ pf1: { value: KNOWS, type: 'NamedNode' } }],
      },
    ]

    const { nodes } = buildRelationshipsGraph(ALICE, BOB, collections)

    expect(nodes.every((n) => n.isEndpoint)).toBe(true)
  })

  it('drops a single-hop edge whose property is not in allowedObjectProperties', () => {
    // KNOWS is not in the whitelist → edge must be silently excluded
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [{ pf1: { value: KNOWS, type: 'NamedNode' } }],
      },
    ]

    const { edges } = buildRelationshipsGraph(ALICE, BOB, collections, [LIKES])

    expect(edges).toHaveLength(0)
  })

  it('keeps a single-hop edge whose property is in allowedObjectProperties', () => {
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [{ pf1: { value: KNOWS, type: 'NamedNode' } }],
      },
    ]

    const { edges } = buildRelationshipsGraph(ALICE, BOB, collections, [KNOWS])

    expect(edges).toHaveLength(1)
  })

  it('accepts all edges when allowedObjectProperties is empty (default)', () => {
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [
          { pf1: { value: KNOWS, type: 'NamedNode' } },
          { pf1: { value: LIKES, type: 'NamedNode' } },
        ],
      },
    ]

    const { edges } = buildRelationshipsGraph(ALICE, BOB, collections, [])

    expect(edges).toHaveLength(2)
  })

  // ── isPropChainValid (multi-hop) ──────────────────────────────────────────────

  it('accepts a multi-hop path when all its properties are whitelisted', () => {
    const CAROL = 'http://example.org/Carol'
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [
          {
            pf1: { value: KNOWS, type: 'NamedNode' },
            of1: { value: CAROL, type: 'NamedNode' },
            pf2: { value: LIKES, type: 'NamedNode' },
          },
        ],
      },
    ]

    const { edges } = buildRelationshipsGraph(ALICE, BOB, collections, [KNOWS, LIKES])

    expect(edges.length).toBeGreaterThan(0)
  })

  it('rejects a multi-hop path when any of its properties is not whitelisted', () => {
    const CAROL = 'http://example.org/Carol'
    const UNLISTED = 'http://example.org/unlistedProp'
    const collections: PathCollection[] = [
      {
        src: ALICE,
        dest: BOB,
        paths: [
          {
            pf1: { value: KNOWS, type: 'NamedNode' },
            of1: { value: CAROL, type: 'NamedNode' },
            pf2: { value: UNLISTED, type: 'NamedNode' },
          },
        ],
      },
    ]

    const { edges } = buildRelationshipsGraph(ALICE, BOB, collections, [KNOWS, LIKES])

    expect(edges).toHaveLength(0)
  })
})

// ── mergeEdgeDuplicates ───────────────────────────────────────────────────────

describe('mergeEdgeDuplicates', () => {
  it('merges two edges between the same node pair into one entry with two IRIs', () => {
    const edges: GraphEdge[] = [
      { sid: 0, tid: 1, iri: KNOWS, label: 'knows' },
      { sid: 0, tid: 1, iri: LIKES, label: 'likes' },
    ]

    const merged = mergeEdgeDuplicates(edges)

    expect(merged).toHaveLength(1)
    expect(merged[0]!.iris).toEqual([KNOWS, LIKES])
  })

  it('does not push a duplicate IRI that already appears in the merged edge', () => {
    // Same sid, tid, AND iri — the second occurrence must be ignored
    const edges: GraphEdge[] = [
      { sid: 0, tid: 1, iri: KNOWS, label: 'knows' },
      { sid: 0, tid: 1, iri: KNOWS, label: 'knows' }, // exact duplicate
    ]

    const merged = mergeEdgeDuplicates(edges)

    expect(merged).toHaveLength(1)
    expect(merged[0]!.iris).toHaveLength(1) // iri was NOT pushed a second time
  })

  it('keeps edges between different node pairs as separate entries', () => {
    const edges: GraphEdge[] = [
      { sid: 0, tid: 1, iri: KNOWS, label: 'knows' },
      { sid: 1, tid: 2, iri: LIKES, label: 'likes' },
    ]

    const merged = mergeEdgeDuplicates(edges)

    expect(merged).toHaveLength(2)
  })

  it('returns an empty array for an empty input', () => {
    expect(mergeEdgeDuplicates([])).toEqual([])
  })
})

// ── applyLabelsAndTypes ───────────────────────────────────────────────────────

describe('applyLabelsAndTypes', () => {
  function makeNode(iri: string): GraphNode {
    return { id: 0, iri, label: 'unlabelled', class: 'Thing', isEndpoint: false }
  }

  it('applies rdfs:label to nodes from the labels map', () => {
    const nodes = [makeNode(ALICE)]
    applyLabelsAndTypes(nodes, [], new Map([[ALICE, 'Alice Smith']]), new Map())
    expect(nodes[0]!.label).toBe('Alice Smith')
  })

  it('sets node.class from the types map; defaults to "Thing" when absent', () => {
    const nodes = [makeNode(ALICE), makeNode(BOB)]
    applyLabelsAndTypes(
      nodes,
      [],
      new Map(),
      new Map([[ALICE, 'http://dbpedia.org/ontology/Person']]),
    )
    expect(nodes[0]!.class).toBe('http://dbpedia.org/ontology/Person')
    expect(nodes[1]!.class).toBe('Thing') // no type entry → fallback
  })

  it('applies labels to edges', () => {
    const edges = [{ iri: KNOWS, label: 'knows' }]
    applyLabelsAndTypes([], edges, new Map([[KNOWS, 'is acquainted with']]), new Map())
    expect(edges[0]!.label).toBe('is acquainted with')
  })
})
