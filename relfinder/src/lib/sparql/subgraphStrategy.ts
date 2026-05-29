/**
 * Subgraph strategy helpers.
 *
 * Decides how to build a local N3 store for a SPARQL connection so that
 * path-finding queries can run locally instead of against the remote endpoint:
 *
 *   Option 2 (≤ 50 000 triples): fetch the entire graph once at connect time.
 *   Option 1 (> 50 000 triples): fetch 2-hop neighbourhoods of both entities
 *     just before each path-finding query.
 *
 * Both functions return a populated N3 Store ready for Comunica's
 * executeSelectOnStore. No Vue dependencies — pure TypeScript lib.
 */

import { Store } from 'n3'
import type { QueryContext } from './types'
import { executeConstruct, executeSelect } from './engine'

export const SMALL_GRAPH_LIMIT = 50_000

// ── Triple-count probe ────────────────────────────────────────────────────────

/**
 * Estimates the total triple count of a SPARQL endpoint via COUNT(*).
 *
 * Returns Infinity on any error or timeout so the caller safely falls back to
 * Option 1 (neighbourhood fetch).
 */
export async function probeTripleCount(
  context: QueryContext,
  signal?: AbortSignal,
): Promise<number> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  // Honour both the caller's signal and the 10 s timeout — whichever fires first.
  const combinedSignal = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal

  try {
    const rows = await executeSelect(
      'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
      context,
      combinedSignal,
    )
    const n = parseInt(rows[0]?.['n']?.value ?? '', 10)
    return isNaN(n) ? Infinity : n
  } catch {
    return Infinity
  } finally {
    clearTimeout(timer)
  }
}

// ── Option 2: full graph fetch ────────────────────────────────────────────────

/**
 * Fetches up to SMALL_GRAPH_LIMIT triples from the endpoint and returns them
 * as a populated N3 Store. Used when the endpoint has ≤ 50 000 triples.
 */
export async function fetchFullGraph(context: QueryContext, signal?: AbortSignal): Promise<Store> {
  const quads = await executeConstruct(
    `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT ${SMALL_GRAPH_LIMIT}`,
    context,
    signal,
  )
  const store = new Store()
  store.addQuads(quads)
  return store
}

// ── Option 1: targeted neighbourhood fetch ────────────────────────────────────

function neighbourhoodQuery(entityIri: string): string {
  return `
    CONSTRUCT { ?s ?p ?o } WHERE {
      { BIND(<${entityIri}> AS ?s) <${entityIri}> ?p ?o }
      UNION
      { ?s ?p <${entityIri}> BIND(<${entityIri}> AS ?o) }
      UNION
      { <${entityIri}> ?p1 ?mid . ?mid ?p ?o . BIND(?mid AS ?s) }
      UNION
      { ?s ?p ?mid . ?mid ?p1 <${entityIri}> . BIND(?mid AS ?o) }
    } LIMIT 5000
  `
}

/**
 * Fetches the 2-hop neighbourhoods of two entities in parallel and merges
 * them into a single N3 Store. Used for large endpoints (> 50 000 triples)
 * immediately before path finding.
 */
export async function fetchNeighbourhoodStore(
  entity1Iri: string,
  entity2Iri: string,
  context: QueryContext,
  signal?: AbortSignal,
): Promise<Store> {
  const q1 = neighbourhoodQuery(entity1Iri)
  const q2 = neighbourhoodQuery(entity2Iri)
  console.log('[fetchNeighbourhoodStore] e1 IRI:', entity1Iri)
  console.log('[fetchNeighbourhoodStore] e2 IRI:', entity2Iri)
  console.log('[fetchNeighbourhoodStore] query1:\n', q1)
  const [quads1, quads2] = await Promise.all([
    executeConstruct(q1, context, signal),
    executeConstruct(q2, context, signal),
  ])
  const store = new Store()
  store.addQuads(quads1)
  store.addQuads(quads2)
  return store
}
