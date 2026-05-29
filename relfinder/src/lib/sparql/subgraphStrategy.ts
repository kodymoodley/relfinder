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
 * All functions accept a SparqlClient so endpoint-specific quirks
 * (CONSTRUCT support, COUNT reliability) are handled transparently.
 */

import { Store } from 'n3'
import type { SparqlClient } from './client'

export const SMALL_GRAPH_LIMIT = 50_000

// ── Triple-count probe ────────────────────────────────────────────────────────

/**
 * Estimates the total triple count of a SPARQL endpoint via COUNT(*).
 *
 * Returns Infinity on any error, timeout, or when the endpoint reports
 * `supportsCount: false` so the caller safely falls back to Option 1.
 */
export async function probeTripleCount(
  client: SparqlClient,
  signal?: AbortSignal,
): Promise<number> {
  if (!client.caps.supportsCount) return Infinity

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  const combinedSignal = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal

  try {
    const rows = await client.select('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }', combinedSignal)
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
export async function fetchFullGraph(client: SparqlClient, signal?: AbortSignal): Promise<Store> {
  const quads = await client.construct(
    `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT ${SMALL_GRAPH_LIMIT}`,
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
  client: SparqlClient,
  signal?: AbortSignal,
): Promise<Store> {
  const q1 = neighbourhoodQuery(entity1Iri)
  const q2 = neighbourhoodQuery(entity2Iri)
  console.log('[fetchNeighbourhoodStore] e1 IRI:', entity1Iri)
  console.log('[fetchNeighbourhoodStore] e2 IRI:', entity2Iri)
  console.log('[fetchNeighbourhoodStore] query1:\n', q1)
  const [quads1, quads2] = await Promise.all([
    client.construct(q1, signal),
    client.construct(q2, signal),
  ])
  const store = new Store()
  store.addQuads(quads1)
  store.addQuads(quads2)
  return store
}
