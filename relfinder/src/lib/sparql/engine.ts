/**
 * Comunica engine wrapper.
 *
 * Provides a thin, typed layer over `@comunica/query-sparql` so the rest of
 * the app never imports Comunica directly. All query execution goes through
 * the two exported functions: `executeSelect` and `executeSelectOnStore`.
 *
 * Design decisions:
 *  - The `QueryEngine` instance is a module-level singleton. Comunica's engine
 *    is stateless — source and auth context are passed per-query — so sharing
 *    one instance is safe and avoids repeated initialisation overhead.
 *  - Credentials are injected via a custom `fetch` wrapper that adds the
 *    `Authorization` header. This keeps Comunica's internals unaware of auth.
 *  - When a proxy URL is set in the connection store, callers should pass it
 *    as `context.endpointUrl`. The proxy IS the endpoint from the browser's
 *    perspective (it reverse-proxies to the real SPARQL endpoint and adds
 *    CORS headers).
 */

import { QueryEngine } from '@comunica/query-sparql'
import type * as RDF from '@rdfjs/types'
import type { Store } from 'n3'
import type { SparqlBinding, QueryContext } from './types'

// ── Engine singleton ──────────────────────────────────────────────────────────

const engine = new QueryEngine()

// ── Auth-aware fetch factory ──────────────────────────────────────────────────

/**
 * Returns a `fetch`-compatible function that injects the Authorization header
 * when `authorizationHeader` is present. Falls back to the global `fetch`
 * when no credentials are configured.
 */
function makeFetch(
  authorizationHeader?: string,
): typeof fetch {
  if (!authorizationHeader) return fetch

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', authorizationHeader)
    return fetch(input, { ...init, headers })
  }
}

// ── Binding conversion ────────────────────────────────────────────────────────

/**
 * Converts a Comunica `RDF.Bindings` object into the plain `SparqlBinding`
 * record used throughout the RelFinder library.
 *
 * `RDF.Bindings` extends `Iterable<[RDF.Variable, RDF.Term]>`, so we spread
 * it with `for...of` rather than calling `.entries()` (which does not exist
 * on the RDF.js interface).
 */
function convertBindings(binding: RDF.Bindings): SparqlBinding {
  const row: SparqlBinding = {}

  for (const [variable, term] of binding) {
    row[variable.value] = {
      value: term.value,
      type: term.termType,
      ...(term.termType === 'Literal' && 'language' in term
        ? { lang: (term as RDF.Literal).language }
        : {}),
    }
  }

  return row
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes a SPARQL SELECT query against a remote SPARQL endpoint and returns
 * all result rows as `SparqlBinding[]`.
 *
 * Throws if the query fails or the endpoint is unreachable.
 */
export async function executeSelect(
  query: string,
  context: QueryContext,
): Promise<SparqlBinding[]> {
  const bindingsStream = await engine.queryBindings(query, {
    sources: [{ type: 'sparql', value: context.endpointUrl }],
    fetch: makeFetch(context.authorizationHeader),
  })

  const rawBindings = await bindingsStream.toArray()
  return rawBindings.map(convertBindings)
}

/**
 * Executes a SPARQL SELECT query against an in-memory N3.js `Store`
 * (used when the user has uploaded a local RDF file).
 *
 * The store is passed as a Comunica RDF.js source, so no HTTP request
 * is made. The `as any` cast is needed because N3's `Store` satisfies the
 * RDF.js `Source` interface at runtime but its TypeScript declarations do not
 * perfectly match Comunica's internal source union type.
 */
export async function executeSelectOnStore(
  query: string,
  store: Store,
): Promise<SparqlBinding[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindingsStream = await engine.queryBindings(query, { sources: [store as any] })
  const rawBindings = await bindingsStream.toArray()
  return rawBindings.map(convertBindings)
}
