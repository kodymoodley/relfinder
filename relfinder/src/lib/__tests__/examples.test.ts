// @vitest-environment node

/**
 * Tests for the built-in quick-start examples.
 *
 * Unit tests (always run):
 *   Each TTL example is parsed in-memory and a full findRelationships() call
 *   is executed using Comunica over the N3 store. The resulting graph must
 *   have between 10 and 50 nodes — enough to be visually interesting without
 *   overwhelming the layout engine.
 *
 * Integration tests (only run when INTEGRATION=1):
 *   The same node-count assertion is made against live DBpedia SPARQL queries.
 *   These are skipped in normal CI because DBpedia can be slow or unavailable.
 *
 *   Run with:  INTEGRATION=1 npm run test:unit
 */

import { describe, it, expect } from 'vitest'
import { parseRdfContent } from '../rdf/parser'
import { findRelationships } from '../sparql/entitySearch'
import { EXAMPLES } from '../examples'
import type { TtlExample, SparqlExample } from '../examples'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIN_NODES = 10
const MAX_NODES = 50

function ttlExamples(): TtlExample[] {
  return EXAMPLES.filter((e): e is TtlExample => e.kind === 'ttl')
}

function sparqlExamples(): SparqlExample[] {
  return EXAMPLES.filter((e): e is SparqlExample => e.kind === 'sparql')
}

// ── Unit tests — TTL examples (in-memory, no network) ─────────────────────────

describe('TTL examples — node count between 10 and 50', () => {
  for (const example of ttlExamples()) {
    // eslint-disable-next-line vitest/valid-title
    it(example.title, async () => {
      const store = await parseRdfContent(example.ttlContent, 'text/turtle')

      const graph = await findRelationships(
        example.entity1.iri,
        example.entity2.iri,
        example.options.maxDistance,
        { endpointUrl: '' },
        {
          ignoredProperties: example.options.ignoredProperties,
          avoidCycles: example.options.avoidCycles,
          store,
          language: example.options.language,
        },
      )

      expect(graph.nodes.length).toBeGreaterThanOrEqual(MIN_NODES)
      expect(graph.nodes.length).toBeLessThanOrEqual(MAX_NODES)

      // Sanity: both endpoints must be present in the graph
      const iris = new Set(graph.nodes.map((n) => n.iri))
      expect(iris.has(example.entity1.iri)).toBe(true)
      expect(iris.has(example.entity2.iri)).toBe(true)

      // Must have at least one edge
      expect(graph.edges.length).toBeGreaterThanOrEqual(1)
    }, 30_000)
  }
})

// ── Integration tests — DBpedia (only when INTEGRATION=1) ────────────────────

describe.skipIf(!process.env['INTEGRATION'])(
  'DBpedia SPARQL examples — node count between 10 and 50 [INTEGRATION]',
  () => {
    for (const example of sparqlExamples()) {
      // eslint-disable-next-line vitest/valid-title
      it(example.title, async () => {
        const graph = await findRelationships(
          example.entity1.iri,
          example.entity2.iri,
          example.options.maxDistance,
          { endpointUrl: example.endpointUrl },
          {
            ignoredProperties: example.options.ignoredProperties,
            avoidCycles: example.options.avoidCycles,
            language: example.options.language,
          },
        )

        expect(graph.nodes.length).toBeGreaterThanOrEqual(MIN_NODES)
        expect(graph.nodes.length).toBeLessThanOrEqual(MAX_NODES)

        const iris = new Set(graph.nodes.map((n) => n.iri))
        expect(iris.has(example.entity1.iri)).toBe(true)
        expect(iris.has(example.entity2.iri)).toBe(true)

        expect(graph.edges.length).toBeGreaterThanOrEqual(1)
      }, 60_000) // DBpedia can be slow — generous timeout
    }
  },
)
