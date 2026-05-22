// @vitest-environment jsdom

/**
 * Unit tests for the connection store.
 *
 * Covers the main user journeys:
 *
 *   SPARQL connection — state flags, sessionStorage persistence, Basic auth
 *   header construction, and the background subgraph probe lifecycle (small
 *   endpoint fetches full graph; large endpoint skips it).
 *
 *   File connection — store exposes the N3 store, no SPARQL probe fires.
 *
 *   Disconnect — all state reset, sessionStorage cleaned, query cache
 *   invalidated, pinned pairs cleared.
 *
 *   Session restore — endpoint URL recovered after page refresh; credentials
 *   deliberately not restored.
 *
 *   waitForSubgraph — resolves immediately when already settled; holds path
 *   finding until the probe completes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { Store, DataFactory } from 'n3'
import { useConnectionStore } from '@/stores/connection'
import { probeTripleCount, fetchFullGraph } from '@/lib/sparql/subgraphStrategy'
import { cacheInvalidate } from '@/lib/cache/queryCache'

vi.mock('@/lib/sparql/subgraphStrategy', () => ({
  probeTripleCount: vi.fn(),
  fetchFullGraph: vi.fn(),
  SMALL_GRAPH_LIMIT: 50_000,
}))

vi.mock('@/lib/cache/queryCache', () => ({
  cacheInvalidate: vi.fn(),
}))

const mockPinnedClear = vi.fn()
vi.mock('@/stores/pinned', () => ({
  usePinnedStore: vi.fn(() => ({ clear: mockPinnedClear })),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  vi.clearAllMocks()
})

// ── connectSparql ─────────────────────────────────────────────────────────────

describe('connectSparql', () => {
  it('marks the store as connected with a SPARQL source', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()

    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })

    expect(store.isConnected).toBe(true)
    expect(store.isSparqlSource).toBe(true)
    expect(store.isFileSource).toBe(false)
  })

  it('exposes endpoint URL through queryContext for downstream SPARQL calls', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()

    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })

    expect(store.queryContext?.endpointUrl).toBe('https://dbpedia.org/sparql')
  })

  it('builds a Basic auth header from user credentials', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()

    store.connectSparql({ endpointUrl: 'https://private.org/sparql', username: 'alice', password: 'secret', proxyUrl: '' })

    expect(store.authorizationHeader).toBe(`Basic ${btoa('alice:secret')}`)
  })

  it('persists endpoint URL to sessionStorage so page refresh does not lose connection', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()

    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })

    expect(sessionStorage.getItem('rf:endpointUrl')).toBe('https://dbpedia.org/sparql')
  })

  it('only stores proxy URL in sessionStorage when one is actually configured', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()

    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })
    expect(sessionStorage.getItem('rf:proxyUrl')).toBeNull()

    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: 'https://proxy.example.org' })
    expect(sessionStorage.getItem('rf:proxyUrl')).toBe('https://proxy.example.org')
  })

  it('small endpoint: fetches the full graph into a local store so path finding runs locally', async () => {
    const { namedNode, quad, defaultGraph } = DataFactory
    const mockStore = new Store()
    mockStore.addQuad(quad(namedNode('http://example.org/Alice'), namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://example.org/Person'), defaultGraph()))
    vi.mocked(probeTripleCount).mockResolvedValue(3_500)
    vi.mocked(fetchFullGraph).mockResolvedValue(mockStore)

    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://small-endpoint.org/sparql', username: '', password: '', proxyUrl: '' })

    await vi.waitFor(() => expect(store.subgraphStatus).toBe('ready'))
    expect(store.localRdfStore?.size).toBe(1)
    expect(store.tripleCount).toBe(3_500)
  })

  it('large endpoint (DBpedia): skips full-graph fetch — neighbourhood strategy is used at query time', async () => {
    vi.mocked(probeTripleCount).mockResolvedValue(500_000_000)

    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })

    await vi.waitFor(() => expect(store.subgraphStatus).toBe('ready'))
    expect(store.localRdfStore).toBeNull()
    expect(fetchFullGraph).not.toHaveBeenCalled()
  })

  it('unreachable endpoint: probe returns Infinity, status reaches ready so path finding can still proceed', async () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)

    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://offline.example.org/sparql', username: '', password: '', proxyUrl: '' })

    await vi.waitFor(() => expect(store.subgraphStatus).toBe('ready'))
    expect(store.localRdfStore).toBeNull()
  })
})

// ── connectFile ───────────────────────────────────────────────────────────────

describe('connectFile', () => {
  it('marks the store as connected with a file source', () => {
    const store = useConnectionStore()

    store.connectFile({ fileName: 'movies.ttl', store: new Store() })

    expect(store.isConnected).toBe(true)
    expect(store.isFileSource).toBe(true)
    expect(store.isSparqlSource).toBe(false)
  })

  it('exposes the N3 store so schema extraction and path finding run locally', () => {
    const { namedNode, quad, defaultGraph } = DataFactory
    const n3Store = new Store()
    n3Store.addQuad(quad(namedNode('http://example.org/Alice'), namedNode('http://example.org/knows'), namedNode('http://example.org/Bob'), defaultGraph()))
    const store = useConnectionStore()

    store.connectFile({ fileName: 'movies.ttl', store: n3Store })

    expect(store.rdfStore?.size).toBe(1)
  })

  it('does not trigger a SPARQL probe — file sources are already local', () => {
    const store = useConnectionStore()

    store.connectFile({ fileName: 'movies.ttl', store: new Store() })

    expect(probeTripleCount).not.toHaveBeenCalled()
    expect(store.subgraphStatus).toBe('idle')
  })

  it('queryContext is null for file sources — no endpoint to query', () => {
    const store = useConnectionStore()

    store.connectFile({ fileName: 'movies.ttl', store: new Store() })

    expect(store.queryContext).toBeNull()
  })
})

// ── disconnect ────────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('resets all connection state when the user clicks Disconnect', async () => {
    vi.mocked(probeTripleCount).mockResolvedValue(500_000_000)
    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })
    await vi.waitFor(() => expect(store.subgraphStatus).toBe('ready'))

    store.disconnect()

    expect(store.isConnected).toBe(false)
    expect(store.source).toBeNull()
    expect(store.localRdfStore).toBeNull()
    expect(store.subgraphStatus).toBe('idle')
    expect(store.tripleCount).toBeNull()
  })

  it('removes persisted endpoint from sessionStorage — next page load shows connection screen', () => {
    vi.mocked(probeTripleCount).mockResolvedValue(Infinity)
    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: 'https://proxy.example.org' })

    store.disconnect()

    expect(sessionStorage.getItem('rf:endpointUrl')).toBeNull()
    expect(sessionStorage.getItem('rf:proxyUrl')).toBeNull()
  })

  it('invalidates the query cache — prevents stale class/instance data leaking to a new endpoint', () => {
    const store = useConnectionStore()
    store.connectFile({ fileName: 'test.ttl', store: new Store() })

    store.disconnect()

    expect(cacheInvalidate).toHaveBeenCalledOnce()
  })

  it('clears pinned entity pairs — pins from one session do not carry over to a new connection', () => {
    const store = useConnectionStore()
    store.connectFile({ fileName: 'test.ttl', store: new Store() })

    store.disconnect()

    expect(mockPinnedClear).toHaveBeenCalledOnce()
  })
})

// ── restoreSession ────────────────────────────────────────────────────────────

describe('restoreSession', () => {
  it('recovers the endpoint URL after a page refresh so the user does not need to re-enter it', () => {
    sessionStorage.setItem('rf:endpointUrl', 'https://dbpedia.org/sparql')
    sessionStorage.setItem('rf:proxyUrl', 'https://proxy.example.org')
    const store = useConnectionStore()

    const restored = store.restoreSession()

    expect(restored?.endpointUrl).toBe('https://dbpedia.org/sparql')
    expect(restored?.proxyUrl).toBe('https://proxy.example.org')
  })

  it('returns null on a fresh load with no previous session', () => {
    const store = useConnectionStore()

    expect(store.restoreSession()).toBeNull()
  })

  it('does not restore credentials — the user must re-enter their password after a refresh', () => {
    sessionStorage.setItem('rf:endpointUrl', 'https://private.org/sparql')
    const store = useConnectionStore()

    const restored = store.restoreSession()

    expect(restored).not.toHaveProperty('username')
    expect(restored).not.toHaveProperty('password')
  })
})

// ── waitForSubgraph ───────────────────────────────────────────────────────────

describe('waitForSubgraph', () => {
  it('resolves immediately when no source is connected (idle)', async () => {
    const store = useConnectionStore()

    await expect(store.waitForSubgraph()).resolves.toBeUndefined()
  })

  it('resolves immediately when the probe has already finished', async () => {
    vi.mocked(probeTripleCount).mockResolvedValue(500_000_000)
    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })
    await vi.waitFor(() => expect(store.subgraphStatus).toBe('ready'))

    await expect(store.waitForSubgraph()).resolves.toBeUndefined()
  })

  it('holds path finding until the endpoint probe completes — prevents racing ahead with wrong strategy', async () => {
    let resolveProbe!: (n: number) => void
    vi.mocked(probeTripleCount).mockImplementation(
      () => new Promise((r) => { resolveProbe = r }),
    )

    const store = useConnectionStore()
    store.connectSparql({ endpointUrl: 'https://dbpedia.org/sparql', username: '', password: '', proxyUrl: '' })
    expect(store.subgraphStatus).toBe('probing')

    let pathFindingStarted = false
    const waitPromise = store.waitForSubgraph().then(() => { pathFindingStarted = true })

    expect(pathFindingStarted).toBe(false)
    resolveProbe(999_999_999) // large endpoint — probe resolves
    await waitPromise
    expect(pathFindingStarted).toBe(true)
  })
})
