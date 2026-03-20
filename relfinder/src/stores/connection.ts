/**
 * Connection store — holds the active SPARQL source configuration.
 *
 * Credentials are kept in memory only (never written to localStorage) so they
 * are cleared automatically when the browser tab is closed. The endpoint URL
 * and proxy URL are optionally persisted to sessionStorage so a page refresh
 * within the same session does not force the user to reconnect.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Store } from 'n3'

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

export const useConnectionStore = defineStore('connection', () => {
  // ── State ──────────────────────────────────────────────────────────────────

  const source = ref<Source | null>(null)
  const isConnected = ref(false)

  // ── Getters ────────────────────────────────────────────────────────────────

  const isSparqlSource = computed(() => source.value?.type === 'sparql')
  const isFileSource = computed(() => source.value?.type === 'file')

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
  }

  function connectFile(config: { fileName: string; store: Store }) {
    source.value = { type: 'file', ...config }
    isConnected.value = true
  }

  function disconnect() {
    source.value = null
    isConnected.value = false
    sessionStorage.removeItem('rf:endpointUrl')
    sessionStorage.removeItem('rf:proxyUrl')
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
    connectSparql,
    connectFile,
    disconnect,
    restoreSession,
  }
})
