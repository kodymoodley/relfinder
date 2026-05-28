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

// Re-export the RDF quad type so callers don't need a direct @rdfjs/types import.
export type { RDF }

// ── Engine singleton ──────────────────────────────────────────────────────────

const engine = new QueryEngine()

// ── Auth-aware fetch factory ──────────────────────────────────────────────────

/**
 * Returns a `fetch`-compatible function that:
 *  - injects the Authorization header when credentials are configured, and
 *  - rewrites requests through the Vercel /api/sparql proxy when `proxyBaseUrl`
 *    is set, passing the real endpoint as `?endpoint=` and preserving the
 *    SPARQL `query` parameter regardless of GET or POST.
 */
function makeFetch(
  authorizationHeader?: string,
  signal?: AbortSignal,
  proxyBaseUrl?: string,
): typeof fetch {
  if (!authorizationHeader && !signal && !proxyBaseUrl) return fetch

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    if (authorizationHeader) headers.set('Authorization', authorizationHeader)

    if (!proxyBaseUrl) {
      console.log('[engine] makeFetch: no proxyBaseUrl, direct fetch to', typeof input === 'string' ? input : input.toString())
      return fetch(input, { ...init, headers, signal })
    }

    // Rewrite the request to go through the Vercel proxy.
    const method = (init?.method ?? 'GET').toUpperCase()
    const parsedUrl = new URL(typeof input === 'string' ? input : input.toString())
    const proxyUrl = new URL(proxyBaseUrl)
    // The real endpoint is the URL without its query string.
    proxyUrl.searchParams.set('endpoint', parsedUrl.origin + parsedUrl.pathname)

    console.log('[engine] makeFetch: rewriting via proxy', { original: parsedUrl.toString(), method, proxyBase: proxyBaseUrl })

    if (method === 'POST') {
      // Comunica POSTs the query as `application/x-www-form-urlencoded` body.
      // The proxy reads `endpoint` from the URL query string and `query` from
      // the body — so we just rewrite the URL and keep the body intact.
      console.log('[engine] makeFetch: POST → proxy URL', proxyUrl.toString())
      return fetch(proxyUrl.toString(), { ...init, headers, signal })
    } else {
      // GET: move `?query=` from the original URL into the proxy URL.
      const sparqlQuery = parsedUrl.searchParams.get('query') ?? ''
      proxyUrl.searchParams.set('query', sparqlQuery)
      console.log('[engine] makeFetch: GET → proxy URL', proxyUrl.toString())
      return fetch(proxyUrl.toString(), { ...init, method: 'GET', headers, signal })
    }
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
  signal?: AbortSignal,
): Promise<SparqlBinding[]> {
  const bindingsStream = await engine.queryBindings(query, {
    sources: [{ type: 'sparql', value: context.endpointUrl }],
    fetch: makeFetch(context.authorizationHeader, signal, context.proxyBaseUrl),
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
export async function executeSelectOnStore(query: string, store: Store): Promise<SparqlBinding[]> {
  const bindingsStream = await engine.queryBindings(query, {
    sources: [store as unknown as RDF.Store],
    unionDefaultGraph: true,
  })
  const rawBindings = await bindingsStream.toArray()
  return rawBindings.map(convertBindings)
}

/**
 * Dispatches a SELECT query to either a local N3 Store or a remote endpoint,
 * depending on whether `store` is provided.
 *
 * Use this instead of calling `executeSelectOnStore` / `executeSelect` directly
 * when the call site already handles both file and SPARQL sources.
 */
export function runSelect(
  query: string,
  context: QueryContext,
  store?: Store,
  signal?: AbortSignal,
): Promise<SparqlBinding[]> {
  return store ? executeSelectOnStore(query, store) : executeSelect(query, context, signal)
}

/**
 * Executes a SPARQL CONSTRUCT query against a remote SPARQL endpoint and
 * returns the resulting triples as an array of RDF.js Quad objects.
 *
 * Callers are responsible for loading the quads into an N3 Store if needed.
 */
export async function executeConstruct(
  query: string,
  context: QueryContext,
  signal?: AbortSignal,
): Promise<RDF.Quad[]> {
  const quadStream = await engine.queryQuads(query, {
    sources: [{ type: 'sparql', value: context.endpointUrl }],
    fetch: makeFetch(context.authorizationHeader, signal, context.proxyBaseUrl),
  })
  return quadStream.toArray()
}
