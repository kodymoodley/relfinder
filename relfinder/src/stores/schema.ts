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

  let abortController: AbortController | null = null

  function setDataPropsStatus(classIri: string, msg: string) {
    dataPropsStatus.value = new Map(dataPropsStatus.value).set(classIri, msg)
  }

  function setDescriptionStatus(classIri: string, msg: string) {
    descriptionStatus.value = new Map(descriptionStatus.value).set(classIri, msg)
  }

  /** Snapshot current reactive state into the localStorage schema entry. */
  function persist(endpointUrl: string, processedSet: Set<string>, classLimit: number, edgeLimit: number) {
    // Guard: if clear() has been called, nodes are already wiped. Persisting now
    // would overwrite a valid earlier snapshot with an empty-nodes entry that
    // would be read back as "fully cached" (processedSet.size >= 0) on the next
    // session, leaving the schema appearing empty.
    if (nodes.value.length === 0) return
    const entry: PersistedSchema = {
      version: 1,
      endpointUrl,
      savedAt: Date.now(),
      classLimit,
      edgeLimit,
      nodes: nodes.value,
      edges: edges.value,
      processedClassIris: Array.from(processedSet),
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

    const endpointUrl = context.endpointUrl || '__file__'
    const processedSet = new Set<string>()

    // ── Try to restore from persistent storage ──────────────────────────────
    const saved = force ? null : loadSchema(endpointUrl)
    const canResume = saved !== null && saved.classLimit === classLimit && saved.edgeLimit === edgeLimit

    if (canResume && saved) {
      nodes.value = saved.nodes
      edges.value = saved.edges
      dataPropsCache.value = new Map(saved.dataPropsCache)
      descriptionCache.value = new Map(saved.descriptionCache)
      for (const iri of saved.processedClassIris) processedSet.add(iri)

      if (processedSet.size >= saved.nodes.length) {
        // Fully cached — nothing to query
        return
      }

      // Partial — show what we have immediately, then resume Phase 2
      progress.value = { completed: processedSet.size, total: saved.nodes.length }
    } else {
      // Fresh start
      nodes.value = []
      edges.value = []
      dataPropsCache.value = new Map()
      descriptionCache.value = new Map()
      progress.value = { completed: 0, total: 0 }
    }

    extracting.value = true
    statusMessage.value = canResume && processedSet.size > 0
      ? `Resuming — ${processedSet.size} of ${saved!.nodes.length} classes already done…`
      : 'Discovering classes…'

    try {
      await extractSchema(
        context,
        n3Store,
        {
          classLimit,
          edgeLimit,
          preloadedNodes: canResume && saved ? saved.nodes : undefined,
          skipClasses: processedSet.size > 0 ? new Set(processedSet) : undefined,
        },
        {
          onClassesLoaded(incoming) {
            nodes.value = incoming
            progress.value = { completed: processedSet.size, total: incoming.length }
            statusMessage.value = ''  // Phase 2 count+bar takes over from here
            // Persist immediately so an abort after Phase 1 still saves the class list
            persist(endpointUrl, processedSet, classLimit, edgeLimit)
          },
          onEdgesLoaded(incoming) {
            edges.value = [...edges.value, ...incoming]
          },
          onProgress(completed, total) {
            progress.value = { completed, total }
          },
          onClassProcessed(classIri) {
            processedSet.add(classIri)
            persist(endpointUrl, processedSet, classLimit, edgeLimit)
          },
        },
        abortController.signal,
      )
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        extractError.value =
          err instanceof Error ? `Extraction failed: ${err.message}` : 'An unexpected error occurred.'
      }
    } finally {
      extracting.value = false
      statusMessage.value = ''
    }
  }

  function cancel() {
    abortController?.abort()
  }

  function clear() {
    abortController?.abort()
    nodes.value = []
    edges.value = []
    extracting.value = false
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    statusMessage.value = ''
    dataPropsCache.value = new Map()
    dataPropsLoading.value = new Set()
    dataPropsStatus.value = new Map()
    descriptionCache.value = new Map()
    descriptionLoading.value = new Set()
    descriptionStatus.value = new Map()
  }

  // ── Per-class data properties ─────────────────────────────────────────────

  async function fetchDataProps(classIri: string, context: QueryContext, n3Store: Store | undefined) {
    if (dataPropsCache.value.has(classIri)) return
    if (dataPropsLoading.value.has(classIri)) return

    dataPropsLoading.value = new Set(dataPropsLoading.value).add(classIri)
    setDataPropsStatus(classIri, 'Querying endpoint…')

    try {
      const props = await fetchSchemaDataProperties(
        classIri,
        context,
        n3Store,
        50,
        (msg) => setDataPropsStatus(classIri, msg),
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

  async function fetchDescription(classIri: string, context: QueryContext, n3Store: Store | undefined) {
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
    nodes, edges, extracting, extractError, progress, progressPct, hasData, statusMessage,
    // options
    hideOrphans,
    // data props
    dataPropsCache, dataPropsLoading, dataPropsStatus,
    // descriptions
    descriptionCache, descriptionLoading, descriptionStatus,
    // actions
    start, cancel, clear, fetchDataProps, fetchDescription,
  }
})
