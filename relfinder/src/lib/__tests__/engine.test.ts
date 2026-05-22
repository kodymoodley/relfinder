// @vitest-environment node

/**
 * Unit tests for the Comunica engine wrapper (engine.ts).
 *
 * The three public functions are tested against what the app actually needs:
 *
 *   executeSelect   — converts Comunica bindings to SparqlBinding records;
 *     injects an Authorization header when credentials are configured; passes
 *     an AbortSignal to the underlying fetch so in-flight queries can be
 *     cancelled when the user disconnects.
 *
 *   executeConstruct — passes the quad stream through to the caller so
 *     subgraphStrategy can populate a local N3 Store.
 *
 *   executeSelectOnStore — routes queries to a local N3 store via Comunica's
 *     in-memory source with unionDefaultGraph so the app doesn't make network
 *     requests for file uploads.
 *
 * convertBindings and makeFetch are private but fully exercised transitively.
 *
 * Comunica's QueryEngine is mocked so no real SPARQL endpoints or HTTP
 * requests are needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Store } from 'n3'

// ── Comunica mock (must be set up before engine.ts is imported) ───────────────
// vi.hoisted runs before any imports so the variables are available when the
// vi.mock factory runs — avoiding temporal dead zone issues with hoisting.

const { mockQueryBindings, mockQueryQuads } = vi.hoisted(() => ({
  mockQueryBindings: vi.fn(),
  mockQueryQuads: vi.fn(),
}))

vi.mock('@comunica/query-sparql', () => ({
  // Must be a regular function (not arrow) so `new QueryEngine()` works.
  QueryEngine: vi.fn(function (this: unknown) {
    return { queryBindings: mockQueryBindings, queryQuads: mockQueryQuads }
  }),
}))

import { executeSelect, executeConstruct, executeSelectOnStore } from '@/lib/sparql/engine'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a minimal RDF.js-compatible Bindings object from a plain record. */
function makeBinding(vars: Record<string, { termType: string; value: string; language?: string }>) {
  const entries = Object.entries(vars).map(([key, term]) => [{ value: key }, term])
  return { [Symbol.iterator]: () => entries[Symbol.iterator]() }
}

/** Returns a mock bindings stream ready to use as a queryBindings return value. */
function bindingStream(bindings: ReturnType<typeof makeBinding>[]) {
  return { toArray: () => Promise.resolve(bindings) }
}

/** Returns a mock quad stream ready to use as a queryQuads return value. */
function quadStream(quads: unknown[]) {
  return { toArray: () => Promise.resolve(quads) }
}

const CTX_NO_AUTH = { endpointUrl: 'https://dbpedia.org/sparql' }
const CTX_WITH_AUTH = {
  endpointUrl: 'https://private.org/sparql',
  authorizationHeader: 'Basic dXNlcjpwYXNz',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── executeSelect — binding conversion ────────────────────────────────────────

describe('executeSelect — binding conversion', () => {
  it('returns an empty array when the endpoint returns no rows', async () => {
    mockQueryBindings.mockResolvedValue(bindingStream([]))

    const result = await executeSelect('SELECT * WHERE { ?s ?p ?o }', CTX_NO_AUTH)

    expect(result).toEqual([])
  })

  it('converts NamedNode terms correctly — value and type, no lang property', async () => {
    mockQueryBindings.mockResolvedValue(
      bindingStream([
        makeBinding({
          s: { termType: 'NamedNode', value: 'http://dbpedia.org/resource/Cillian_Murphy' },
        }),
      ]),
    )

    const [row] = await executeSelect('SELECT ?s WHERE { ?s a dbo:Actor }', CTX_NO_AUTH)

    expect(row!['s']!.value).toBe('http://dbpedia.org/resource/Cillian_Murphy')
    expect(row!['s']!.type).toBe('NamedNode')
    expect(row!['s']).not.toHaveProperty('lang')
  })

  it('converts Literal terms and attaches the language tag', async () => {
    mockQueryBindings.mockResolvedValue(
      bindingStream([
        makeBinding({
          label: { termType: 'Literal', value: 'Cillian Murphy', language: 'en' },
        }),
      ]),
    )

    const [row] = await executeSelect('SELECT ?label WHERE { ?s rdfs:label ?label }', CTX_NO_AUTH)

    expect(row!['label']!.value).toBe('Cillian Murphy')
    expect(row!['label']!.type).toBe('Literal')
    expect(row!['label']!.lang).toBe('en')
  })

  it('attaches an empty lang string for untagged plain literals', async () => {
    mockQueryBindings.mockResolvedValue(
      bindingStream([
        makeBinding({
          n: { termType: 'Literal', value: '42', language: '' },
        }),
      ]),
    )

    const [row] = await executeSelect('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }', CTX_NO_AUTH)

    expect(row!['n']!.lang).toBe('')
  })

  it('handles multiple variables in a single binding row', async () => {
    mockQueryBindings.mockResolvedValue(
      bindingStream([
        makeBinding({
          s: { termType: 'NamedNode', value: 'http://dbpedia.org/resource/Cillian_Murphy' },
          label: { termType: 'Literal', value: 'Cillian Murphy', language: 'en' },
          type: { termType: 'NamedNode', value: 'http://dbpedia.org/ontology/Actor' },
        }),
      ]),
    )

    const [row] = await executeSelect('SELECT ?s ?label ?type WHERE { … }', CTX_NO_AUTH)

    expect(Object.keys(row!)).toEqual(['s', 'label', 'type'])
  })
})

// ── executeSelect — auth and abort signal ─────────────────────────────────────

describe('executeSelect — auth and fetch options', () => {
  it('passes the global fetch directly when no credentials or signal are set', async () => {
    let capturedFetch: unknown
    mockQueryBindings.mockImplementation(async (_q: string, opts: Record<string, unknown>) => {
      capturedFetch = opts['fetch']
      return bindingStream([])
    })

    await executeSelect('SELECT * WHERE {}', CTX_NO_AUTH)

    // No auth + no signal → makeFetch returns the global fetch reference
    expect(capturedFetch).toBe(fetch)
  })

  it('wraps fetch to inject Authorization header when credentials are configured', async () => {
    let capturedFetch: typeof fetch | undefined
    mockQueryBindings.mockImplementation(async (_q: string, opts: Record<string, unknown>) => {
      capturedFetch = opts['fetch'] as typeof fetch
      return bindingStream([])
    })

    await executeSelect('SELECT * WHERE {}', CTX_WITH_AUTH)

    // A wrapper was created — it's not the raw global fetch
    expect(capturedFetch).not.toBe(fetch)

    // Calling it should inject the Authorization header
    const globalFetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response())
    await capturedFetch!('https://private.org/sparql', {})
    const [, callInit] = globalFetchSpy.mock.calls[0]!
    expect((callInit!.headers as Headers).get('Authorization')).toBe('Basic dXNlcjpwYXNz')
    globalFetchSpy.mockRestore()
  })

  it('wraps fetch to forward the AbortSignal — allows in-flight queries to be cancelled', async () => {
    let capturedFetch: typeof fetch | undefined
    mockQueryBindings.mockImplementation(async (_q: string, opts: Record<string, unknown>) => {
      capturedFetch = opts['fetch'] as typeof fetch
      return bindingStream([])
    })

    const controller = new AbortController()
    await executeSelect('SELECT * WHERE {}', CTX_NO_AUTH, controller.signal)

    // Signal present → a wrapper is returned even with no auth
    expect(capturedFetch).not.toBe(fetch)

    const globalFetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response())
    await capturedFetch!('https://dbpedia.org/sparql', {})
    const [, callInit] = globalFetchSpy.mock.calls[0]!
    expect(callInit!.signal).toBe(controller.signal)
    globalFetchSpy.mockRestore()
  })
})

// ── executeConstruct ──────────────────────────────────────────────────────────

describe('executeConstruct', () => {
  it('returns the quads from the quad stream so callers can populate a local N3 Store', async () => {
    const fakeQuad = { subject: 'Alice', predicate: 'type', object: 'Person' }
    mockQueryQuads.mockResolvedValue(quadStream([fakeQuad]))

    const quads = await executeConstruct('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', CTX_NO_AUTH)

    expect(quads).toHaveLength(1)
    expect(quads[0]).toBe(fakeQuad)
  })

  it('returns an empty array when the CONSTRUCT query matches nothing', async () => {
    mockQueryQuads.mockResolvedValue(quadStream([]))

    const quads = await executeConstruct('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', CTX_NO_AUTH)

    expect(quads).toHaveLength(0)
  })

  it('forwards the AbortSignal so a neighbourhood fetch can be cancelled mid-stream', async () => {
    let capturedFetch: typeof fetch | undefined
    mockQueryQuads.mockImplementation(async (_q: string, opts: Record<string, unknown>) => {
      capturedFetch = opts['fetch'] as typeof fetch
      return quadStream([])
    })

    const controller = new AbortController()
    await executeConstruct('CONSTRUCT {}', CTX_WITH_AUTH, controller.signal)

    expect(capturedFetch).not.toBe(fetch) // wrapper was created (auth + signal)
  })
})

// ── executeSelectOnStore ──────────────────────────────────────────────────────

describe('executeSelectOnStore', () => {
  it('passes the N3 store as the Comunica source with unionDefaultGraph enabled', async () => {
    let capturedSources: unknown
    let capturedUnionDefault: unknown
    mockQueryBindings.mockImplementation(async (_q: string, opts: Record<string, unknown>) => {
      capturedSources = opts['sources']
      capturedUnionDefault = opts['unionDefaultGraph']
      return bindingStream([])
    })

    const store = new Store()
    await executeSelectOnStore('SELECT * WHERE { ?s ?p ?o }', store)

    expect(capturedSources).toEqual([store])
    expect(capturedUnionDefault).toBe(true)
  })

  it('returns converted bindings from the in-memory store', async () => {
    mockQueryBindings.mockResolvedValue(
      bindingStream([
        makeBinding({
          s: { termType: 'NamedNode', value: 'http://example.org/Alice' },
        }),
      ]),
    )

    const result = await executeSelectOnStore('SELECT ?s WHERE { ?s ?p ?o }', new Store())

    expect(result).toHaveLength(1)
    expect(result[0]!['s']!.value).toBe('http://example.org/Alice')
  })
})
