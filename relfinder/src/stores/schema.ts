import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Store } from 'n3'
import { extractSchema, fetchSchemaDataProperties } from '@/lib/sparql/schemaExtractor'
import { fetchClassDescription } from '@/lib/sparql/classDescription'
import { loadSchema, saveSchema } from '@/lib/cache/schemaStorage'
import type { PersistedSchema } from '@/lib/cache/schemaStorage'
import type { SchemaNode, SchemaEdge, SchemaDataProp, QueryContext } from '@/lib/sparql/types'

export const useSchemaStore = defineStore('schema', () => {
  // ── Graph state ──────────────────────────────────────────────────────────────

  const nodes = ref<SchemaNode[]>([])
  const edges = ref<SchemaEdge[]>([])
  const extracting = ref(false)
  const extractError = ref('')
  const progress = ref({ completed: 0, total: 0 })
  const statusMessage = ref('')
  const lastBatchSize = ref(0)

  const progressPct = computed(() =>
    progress.value.total > 0
      ? Math.round((progress.value.completed / progress.value.total) * 100)
      : 0,
  )
  const hasData = computed(() => nodes.value.length > 0)

  // ── Display options ───────────────────────────────────────────────────────────

  const hideOrphans = ref(false)

  // ── Data properties cache ────────────────────────────────────────────────────

  const dataPropsCache = ref(new Map<string, SchemaDataProp[]>())
  const dataPropsLoading = ref(new Set<string>())
  const dataPropsStatus = ref(new Map<string, string>())

  // ── Description cache ────────────────────────────────────────────────────────

  const descriptionCache = ref(new Map<string, string>())
  const descriptionLoading = ref(new Set<string>())
  const descriptionStatus = ref(new Map<string, string>())

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // Module-level so both start() and loadMore() share the same processed set.
  let abortController: AbortController | null = null
  const _processedSet = new Set<string>()
  let _context: QueryContext | null = null
  let _n3Store: Store | undefined = undefined
  let _classLimit = 40
  let _edgeLimit = 10

  function setDataPropsStatus(classIri: string, msg: string) {
    dataPropsStatus.value = new Map(dataPropsStatus.value).set(classIri, msg)
  }

  function setDescriptionStatus(classIri: string, msg: string) {
    descriptionStatus.value = new Map(descriptionStatus.value).set(classIri, msg)
  }

  /** Snapshot current reactive state into the localStorage schema entry. */
  function persist(endpointUrl: string) {
    if (nodes.value.length === 0) return
    const entry: PersistedSchema = {
      version: 1,
      endpointUrl,
      savedAt: Date.now(),
      classLimit: _classLimit,
      edgeLimit: _edgeLimit,
      nodes: nodes.value,
      edges: edges.value,
      processedClassIris: Array.from(_processedSet),
      dataPropsCache: Array.from(dataPropsCache.value.entries()),
      descriptionCache: Array.from(descriptionCache.value.entries()),
    }
    saveSchema(endpointUrl, entry)
  }

  // ── Extraction ───────────────────────────────────────────────────────────────

  /**
   * Start (or resume) schema extraction for the given endpoint.
   * @param force  When true, ignore any cached schema and extract from scratch.
   */
  async function start(
    context: QueryContext,
    n3Store: Store | undefined,
    classLimit: number,
    edgeLimit: number,
    force = false,
  ) {
    abortController = new AbortController()
    extractError.value = ''
    _context = context
    _n3Store = n3Store
    _classLimit = classLimit
    _edgeLimit = edgeLimit
    _processedSet.clear()

    const endpointUrl = context.endpointUrl || '__file__'

    console.log(
      '[schema] start() called — force:',
      force,
      'current nodes:',
      nodes.value.length,
      'extracting:',
      extracting.value,
    )

    // ── Try to restore from persistent storage ──────────────────────────────
    const saved = force ? null : loadSchema(endpointUrl)
    const canResume =
      saved !== null && saved.classLimit === classLimit && saved.edgeLimit === edgeLimit

    if (canResume && saved) {
      nodes.value = saved.nodes
      edges.value = saved.edges
      dataPropsCache.value = new Map(saved.dataPropsCache)
      descriptionCache.value = new Map(saved.descriptionCache)
      const nodeIriSet = new Set(saved.nodes.map((n) => n.iri))
      for (const iri of saved.processedClassIris) {
        if (nodeIriSet.has(iri)) _processedSet.add(iri)
      }
      lastBatchSize.value = saved.nodes.length

      console.log(
        '[schema] cache check — saved:',
        !!saved,
        'canResume:',
        canResume,
        `processed ${_processedSet.size}/${saved.nodes.length}`,
      )

      if (_processedSet.size >= saved.nodes.length) {
        console.log('[schema] FULLY CACHED — returning early, no extraction')
        return
      }

      console.log(
        '[schema] PARTIAL CACHE — resuming Phase 2 for',
        saved.nodes.length - _processedSet.size,
        'remaining classes',
      )

      progress.value = { completed: _processedSet.size, total: saved.nodes.length }
    } else {
      // Fresh start
      nodes.value = []
      edges.value = []
      dataPropsCache.value = new Map()
      descriptionCache.value = new Map()
      progress.value = { completed: 0, total: 0 }
      lastBatchSize.value = 0
    }

    extracting.value = true
    statusMessage.value =
      canResume && _processedSet.size > 0 ? `Resuming...` : 'Discovering classes…'

    try {
      await extractSchema(
        context,
        n3Store,
        {
          classLimit,
          edgeLimit,
          preloadedNodes: canResume && saved ? saved.nodes : undefined,
          skipClasses: _processedSet.size > 0 ? new Set(_processedSet) : undefined,
        },
        {
          onDescriptionsLoaded(map) {
            descriptionCache.value = new Map([...descriptionCache.value, ...map])
          },
          onClassesLoaded(incoming) {
            lastBatchSize.value = incoming.length
            nodes.value = incoming
            progress.value = { completed: _processedSet.size, total: incoming.length }
            statusMessage.value = ''
            persist(endpointUrl)
          },
          onEdgesLoaded(incoming) {
            edges.value = [...edges.value, ...incoming]
            console.log(
              '[schema] onEdgesLoaded — total edges now:',
              edges.value.length,
              '| extracting:',
              extracting.value,
            )
          },
          onProgress(completed, total) {
            progress.value = { completed, total }
          },
          onClassProcessed(classIri) {
            _processedSet.add(classIri)
            console.log(
              '[schema] onClassProcessed',
              classIri,
              '| processed:',
              _processedSet.size,
              '| extracting:',
              extracting.value,
            )
            persist(endpointUrl)
          },
        },
        abortController.signal,
      )
      console.log('[schema] extractSchema returned — setting extracting=false')
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        extractError.value =
          err instanceof Error
            ? `Extraction failed: ${err.message}`
            : 'An unexpected error occurred.'
      }
    } finally {
      console.log(
        '[schema] finally — extracting was:',
        extracting.value,
        '| edges:',
        edges.value.length,
        '| nodes:',
        nodes.value.length,
      )
      extracting.value = false
      statusMessage.value = ''
    }
  }

  /**
   * Fetch the next page of classes and append them to the current graph.
   * Uses the same classLimit/edgeLimit as the initial extraction.
   * No-ops when an extraction is already in progress or no context is stored.
   */
  async function loadMore() {
    if (!_context || extracting.value) return

    const context = _context
    const n3Store = _n3Store
    const classLimit = _classLimit
    const edgeLimit = _edgeLimit
    const offset = nodes.value.length
    const existingIris = nodes.value.map((n) => n.iri)
    const endpointUrl = context.endpointUrl || '__file__'

    abortController = new AbortController()
    extracting.value = true
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    statusMessage.value = 'Discovering more classes…'

    const batchProcessed = new Set<string>()

    try {
      await extractSchema(
        context,
        n3Store,
        {
          classLimit,
          edgeLimit,
          classOffset: offset,
          additionalClassIris: existingIris,
        },
        {
          onDescriptionsLoaded(map) {
            descriptionCache.value = new Map([...descriptionCache.value, ...map])
          },
          onClassesLoaded(incoming) {
            lastBatchSize.value = incoming.length
            nodes.value = [...nodes.value, ...incoming]
            progress.value = { completed: _processedSet.size, total: nodes.value.length }
            statusMessage.value = ''
            persist(endpointUrl)
          },
          onEdgesLoaded(incoming) {
            edges.value = [...edges.value, ...incoming]
          },
          onProgress(completed, total) {
            progress.value = { completed, total }
          },
          onClassProcessed(classIri) {
            batchProcessed.add(classIri)
            _processedSet.add(classIri)
            persist(endpointUrl)
          },
        },
        abortController.signal,
      )
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        extractError.value =
          err instanceof Error
            ? `Extraction failed: ${err.message}`
            : 'An unexpected error occurred.'
      }
    } finally {
      extracting.value = false
      statusMessage.value = ''
    }
  }

  function cancel() {
    console.log('[schema] cancel() called')
    abortController?.abort()
    extracting.value = false
    statusMessage.value = ''
  }

  function clear() {
    console.log('[schema] clear() called — nodes before clear:', nodes.value.length)
    abortController?.abort()
    nodes.value = []
    edges.value = []
    extracting.value = false
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    statusMessage.value = ''
    lastBatchSize.value = 0
    dataPropsCache.value = new Map()
    dataPropsLoading.value = new Set()
    dataPropsStatus.value = new Map()
    descriptionCache.value = new Map()
    descriptionLoading.value = new Set()
    descriptionStatus.value = new Map()
    _processedSet.clear()
    _context = null
    _n3Store = undefined
  }

  // ── Per-class data properties ─────────────────────────────────────────────

  async function fetchDataProps(
    classIri: string,
    context: QueryContext,
    n3Store: Store | undefined,
  ) {
    if (dataPropsCache.value.has(classIri)) return
    if (dataPropsLoading.value.has(classIri)) return

    dataPropsLoading.value = new Set(dataPropsLoading.value).add(classIri)
    setDataPropsStatus(classIri, 'Querying endpoint…')

    try {
      const props = await fetchSchemaDataProperties(classIri, context, n3Store, 50, (msg) =>
        setDataPropsStatus(classIri, msg),
      )
      dataPropsCache.value = new Map(dataPropsCache.value).set(classIri, props)
    } finally {
      const next = new Set(dataPropsLoading.value)
      next.delete(classIri)
      dataPropsLoading.value = next
      const s = new Map(dataPropsStatus.value)
      s.delete(classIri)
      dataPropsStatus.value = s
    }
  }

  // ── Per-class descriptions ────────────────────────────────────────────────

  async function fetchDescription(
    classIri: string,
    context: QueryContext,
    n3Store: Store | undefined,
  ) {
    if (descriptionCache.value.has(classIri)) return
    if (descriptionLoading.value.has(classIri)) return

    descriptionLoading.value = new Set(descriptionLoading.value).add(classIri)
    setDescriptionStatus(classIri, 'Fetching description…')

    try {
      const text = await fetchClassDescription(classIri, context, n3Store)
      descriptionCache.value = new Map(descriptionCache.value).set(classIri, text)
    } finally {
      const next = new Set(descriptionLoading.value)
      next.delete(classIri)
      descriptionLoading.value = next
      const s = new Map(descriptionStatus.value)
      s.delete(classIri)
      descriptionStatus.value = s
    }
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  return {
    // graph
    nodes,
    edges,
    extracting,
    extractError,
    progress,
    progressPct,
    hasData,
    statusMessage,
    lastBatchSize,
    // options
    hideOrphans,
    // data props
    dataPropsCache,
    dataPropsLoading,
    dataPropsStatus,
    // descriptions
    descriptionCache,
    descriptionLoading,
    descriptionStatus,
    // actions
    start,
    loadMore,
    cancel,
    clear,
    fetchDataProps,
    fetchDescription,
  }
})
