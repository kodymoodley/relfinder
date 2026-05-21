/**
 * Connection store — holds the active SPARQL source configuration.
 *
 * Credentials are kept in memory only (never written to localStorage) so they
 * are cleared automatically when the browser tab is closed. The endpoint URL
 * and proxy URL are optionally persisted to sessionStorage so a page refresh
 * within the same session does not force the user to reconnect.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Store } from 'n3'
import { cacheInvalidate } from '@/lib/cache/queryCache'
import { usePinnedStore } from './pinned'
import {
  probeTripleCount,
  fetchFullGraph,
  SMALL_GRAPH_LIMIT,
} from '@/lib/sparql/subgraphStrategy'

export type SubgraphStatus = 'idle' | 'probing' | 'fetching' | 'ready' | 'error'

export type SourceType = 'sparql' | 'file'

export interface SparqlSource {
  type: 'sparql'
  /** Full URL of the SPARQL endpoint, e.g. https://dbpedia.org/sparql */
  endpointUrl: string
  /** Optional username for HTTP Basic authentication */
  username: string
  /** Optional password for HTTP Basic authentication — held in memory only */
  password: string
  /**
   * Optional CORS proxy URL. When set, Comunica will route requests through
   * this proxy instead of querying the endpoint directly. Follows the same
   * convention as YASGUI: the proxy receives `endpoint` and `method` as POST
   * parameters and forwards them on.
   */
  proxyUrl: string
}

export interface FileSource {
  type: 'file'
  /** Human-readable filename shown in the UI */
  fileName: string
  /** Parsed in-memory RDF store — passed directly to Comunica */
  store: Store
}

export type Source = SparqlSource | FileSource

// Module-level abort controller for in-flight subgraph fetch (not reactive).
let _subgraphAbort: AbortController | null = null

export const useConnectionStore = defineStore('connection', () => {
  // ── State ──────────────────────────────────────────────────────────────────

  const source = ref<Source | null>(null)
  const isConnected = ref(false)

  // Local N3 store built from a CONSTRUCT fetch (SPARQL sources only).
  const localRdfStore = ref<Store | null>(null)
  const subgraphStatus = ref<SubgraphStatus>('idle')
  const tripleCount = ref<number | null>(null)

  // ── Getters ────────────────────────────────────────────────────────────────

  const isSparqlSource = computed<boolean>(() => source.value?.type === 'sparql')
  const isFileSource = computed<boolean>(() => source.value?.type === 'file')

  /**
   * Returns the Authorization header value for the active SPARQL source,
   * or undefined if no credentials are set.
   */
  const authorizationHeader = computed<string | undefined>(() => {
    if (source.value?.type !== 'sparql') return undefined
    const { username, password } = source.value
    if (!username) return undefined
    return `Basic ${btoa(`${username}:${password}`)}`
  })

  /**
   * Ready-to-use QueryContext for the lib/sparql functions.
   * Returns null when no source is connected.
   */
  const queryContext = computed(() => {
    if (source.value?.type !== 'sparql') return null
    return {
      endpointUrl: source.value.endpointUrl,
      authorizationHeader: authorizationHeader.value,
    }
  })

  /**
   * The N3.js Store for file-based sources, or null for SPARQL sources.
   */
  const rdfStore = computed(() => {
    if (source.value?.type !== 'file') return null
    return source.value.store
  })

  // ── Actions ────────────────────────────────────────────────────────────────

  function connectSparql(config: Omit<SparqlSource, 'type'>) {
    source.value = { type: 'sparql', ...config }
    isConnected.value = true

    // Persist non-sensitive fields to sessionStorage so a page refresh within
    // the same tab does not lose the endpoint URL.
    sessionStorage.setItem('rf:endpointUrl', config.endpointUrl)
    if (config.proxyUrl) {
      sessionStorage.setItem('rf:proxyUrl', config.proxyUrl)
    }

    // Kick off probe + optional full-graph fetch in the background.
    _initSubgraph().catch(() => {
      subgraphStatus.value = 'error'
    })
  }

  async function _initSubgraph() {
    // Cancel any previous in-flight run (e.g. user reconnected quickly).
    _subgraphAbort?.abort()
    _subgraphAbort = new AbortController()
    const signal = _subgraphAbort.signal

    localRdfStore.value = null
    tripleCount.value = null
    subgraphStatus.value = 'probing'

    const ctx = queryContext.value
    if (!ctx) { subgraphStatus.value = 'error'; return }

    const n = await probeTripleCount(ctx, signal)
    if (signal.aborted) return
    tripleCount.value = n

    if (n <= SMALL_GRAPH_LIMIT) {
      subgraphStatus.value = 'fetching'
      localRdfStore.value = await fetchFullGraph(ctx, signal)
      if (signal.aborted) { localRdfStore.value = null; return }
    }

    subgraphStatus.value = 'ready'
  }

  /**
   * Returns a Promise that resolves once the background subgraph init has
   * reached 'ready' or 'error'. GraphView calls this before path finding so it
   * can choose the right store without racing the probe.
   */
  function waitForSubgraph(): Promise<void> {
    if (subgraphStatus.value === 'ready' || subgraphStatus.value === 'error' || subgraphStatus.value === 'idle') {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const stop = watch(subgraphStatus, (v) => {
        if (v === 'ready' || v === 'error') {
          stop()
          resolve()
        }
      })
    })
  }

  function connectFile(config: { fileName: string; store: Store }) {
    source.value = { type: 'file', ...config }
    isConnected.value = true
  }

  function disconnect() {
    _subgraphAbort?.abort()
    _subgraphAbort = null
    source.value = null
    isConnected.value = false
    localRdfStore.value = null
    subgraphStatus.value = 'idle'
    tripleCount.value = null
    sessionStorage.removeItem('rf:endpointUrl')
    sessionStorage.removeItem('rf:proxyUrl')
    cacheInvalidate()
    usePinnedStore().clear()
  }

  /**
   * Restores non-sensitive connection details from sessionStorage after a
   * page refresh. Credentials are intentionally NOT restored — the user must
   * re-enter them.
   */
  function restoreSession(): Partial<SparqlSource> | null {
    const endpointUrl = sessionStorage.getItem('rf:endpointUrl')
    if (!endpointUrl) return null
    return {
      endpointUrl,
      proxyUrl: sessionStorage.getItem('rf:proxyUrl') ?? '',
    }
  }

  return {
    source,
    isConnected,
    isSparqlSource,
    isFileSource,
    authorizationHeader,
    queryContext,
    rdfStore,
    localRdfStore,
    subgraphStatus,
    tripleCount,
    connectSparql,
    connectFile,
    disconnect,
    restoreSession,
    waitForSubgraph,
  }
})
