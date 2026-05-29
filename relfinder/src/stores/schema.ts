import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Store } from 'n3'
import { extractSchema, fetchSchemaDataProperties } from '@/lib/sparql/schemaExtractor'
import { fetchInstancesByClass, fetchEntityProps } from '@/lib/sparql/entitySearch'
import { fetchClassDescription } from '@/lib/sparql/classDescription'
import { loadSchema, saveSchema } from '@/lib/cache/schemaStorage'
import type { PersistedSchema } from '@/lib/cache/schemaStorage'
import type { SchemaNode, SchemaEdge, SchemaDataProp, QueryContext } from '@/lib/sparql/types'
import { cacheAdd } from '@/lib/search/entityCache'
import type { CachedEntity } from '@/lib/search/types'
import type { Ref } from 'vue'

/**
 * Guards a cache-populate action: skips if already cached or in-flight,
 * manages the loading set, and optionally removes from a status map on completion.
 *
 * `onDone` is called after the result is stored in `cache` and before the
 * loading set is cleaned up — use it for side effects that depend on the
 * fresh cache entry.
 */
async function withLoadingGuard<T>(
  key: string,
  cache: Ref<Map<string, T>>,
  loadingSet: Ref<Set<string>>,
  work: () => Promise<T>,
  statusMap?: Ref<Map<string, string>>,
  onDone?: (result: T) => void,
): Promise<void> {
  if (cache.value.has(key) || loadingSet.value.has(key)) return
  loadingSet.value.add(key)
  try {
    const result = await work()
    cache.value.set(key, result)
    onDone?.(result)
  } finally {
    loadingSet.value.delete(key)
    statusMap?.value.delete(key)
  }
}

function toEntityCacheEntry(
  inst: { iri: string; label: string },
  classIri: string,
  classLabel: string,
  now: number,
): CachedEntity {
  return {
    iri: inst.iri,
    label: inst.label,
    altLabels: [],
    classIri,
    classLabel,
    description: '',
    addedAt: now,
    lastAccessed: now,
  }
}

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

  // ── Instances cache ──────────────────────────────────────────────────────────

  const instancesCache = ref(new Map<string, Array<{ iri: string; label: string }>>())
  const instancesLoading = ref(new Set<string>())

  // ── Entity props cache ────────────────────────────────────────────────────────

  type EntityProp = { predIri: string; predLabel: string; value: string }
  const entityPropsCache = ref(new Map<string, EntityProp[]>())
  const entityPropsLoading = ref(new Set<string>())

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // Shared across start() and loadMore() calls within the same store instance.
  let abortController: AbortController | null = null
  const _processedSet = new Set<string>()
  let _context: QueryContext | null = null
  let _n3Store: Store | undefined = undefined
  let _classLimit = 40
  let _edgeLimit = 10

  function setDataPropsStatus(classIri: string, msg: string) {
    dataPropsStatus.value.set(classIri, msg)
  }

  function setDescriptionStatus(classIri: string, msg: string) {
    descriptionStatus.value.set(classIri, msg)
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

    // File sources (N3 Store) are never cached — extraction is in-memory and
    // fast, and using a shared '__file__' key would cause different uploads to
    // collide in localStorage.
    const isFileSource = n3Store !== undefined
    const endpointUrl = isFileSource ? '' : context.endpointUrl || '__file__'

    // ── Try to restore from persistent storage ──────────────────────────────
    const saved = force || isFileSource ? null : loadSchema(endpointUrl)
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

      if (_processedSet.size >= saved.nodes.length) {
        return
      }

      progress.value = { completed: _processedSet.size, total: saved.nodes.length }
    } else {
      // Fresh start
      nodes.value = []
      edges.value = []
      dataPropsCache.value.clear()
      descriptionCache.value.clear()
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
            for (const [k, v] of map) descriptionCache.value.set(k, v)
          },
          onClassesLoaded(incoming) {
            lastBatchSize.value = incoming.length
            nodes.value = [...incoming]
            progress.value = { completed: _processedSet.size, total: incoming.length }
            statusMessage.value = ''
            if (!isFileSource) persist(endpointUrl)
          },
          onEdgesLoaded(incoming) {
            edges.value.push(...incoming)
          },
          onProgress(completed, total) {
            progress.value = { completed, total }
          },
          onClassProcessed(classIri) {
            _processedSet.add(classIri)
            fetchInstances(classIri, context, n3Store).catch(() => {})
            fetchDataProps(classIri, context, n3Store).catch(() => {})
            if (!isFileSource) persist(endpointUrl)
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

  /**
   * Fetch the next page of classes and append them to the current graph.
   * Uses the same classLimit/edgeLimit as the initial extraction.
   * No-ops when an extraction is already in progress or no context is stored.
   */
  async function loadMore() {
    console.log('[schemaStore] loadMore called', { hasContext: !!_context, extracting: extracting.value, nodeCount: nodes.value.length })
    if (!_context || extracting.value) {
      console.log('[schemaStore] loadMore bailed out early', { hasContext: !!_context, extracting: extracting.value })
      return
    }

    const context = _context
    const n3Store = _n3Store
    const classLimit = _classLimit
    const edgeLimit = _edgeLimit
    const offset = nodes.value.length
    const existingIris = nodes.value.map((n) => n.iri)
    const isFileSource = n3Store !== undefined
    const endpointUrl = isFileSource ? '' : context.endpointUrl || '__file__'

    console.log('[schemaStore] loadMore starting', { offset, classLimit, edgeLimit, existingCount: existingIris.length, endpoint: context.endpointUrl })

    abortController = new AbortController()
    extracting.value = true
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    statusMessage.value = 'Discovering more classes…'

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
            for (const [k, v] of map) descriptionCache.value.set(k, v)
          },
          onClassesLoaded(incoming) {
            const existingIris = new Set(nodes.value.map((n) => n.iri))
            const novel = incoming.filter((n) => !existingIris.has(n.iri))
            console.log(`[schemaStore] loadMore onClassesLoaded: ${incoming.length} returned, ${novel.length} novel`)
            lastBatchSize.value = novel.length
            nodes.value.push(...novel)
            progress.value = { completed: _processedSet.size, total: nodes.value.length }
            statusMessage.value = ''
            if (!isFileSource) persist(endpointUrl)
          },
          onEdgesLoaded(incoming) {
            edges.value.push(...incoming)
          },
          onProgress(completed, total) {
            console.log(`[schemaStore] loadMore progress: ${completed}/${total}`)
            progress.value = { completed, total }
          },
          onClassProcessed(classIri) {
            console.log('[schemaStore] loadMore onClassProcessed:', classIri)
            _processedSet.add(classIri)
            fetchInstances(classIri, context, n3Store).catch(() => {})
            fetchDataProps(classIri, context, n3Store).catch(() => {})
            if (!isFileSource) persist(endpointUrl)
          },
        },
        abortController.signal,
      )
      console.log('[schemaStore] loadMore extractSchema resolved')
    } catch (err) {
      console.error('[schemaStore] loadMore error:', err)
      if ((err as Error)?.name !== 'AbortError') {
        extractError.value =
          err instanceof Error
            ? `Extraction failed: ${err.message}`
            : 'An unexpected error occurred.'
      }
    } finally {
      console.log('[schemaStore] loadMore finally: resetting extracting, nodeCount now', nodes.value.length)
      extracting.value = false
      statusMessage.value = ''
    }
  }

  function cancel() {
    abortController?.abort()
    extracting.value = false
    statusMessage.value = ''
  }

  function clear() {
    abortController?.abort()
    nodes.value = []
    edges.value = []
    extracting.value = false
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    statusMessage.value = ''
    lastBatchSize.value = 0
    dataPropsCache.value.clear()
    dataPropsLoading.value.clear()
    dataPropsStatus.value.clear()
    descriptionCache.value.clear()
    descriptionLoading.value.clear()
    descriptionStatus.value.clear()
    instancesLoading.value.clear()
    entityPropsLoading.value.clear()
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
    await withLoadingGuard(
      classIri,
      dataPropsCache,
      dataPropsLoading,
      () => {
        setDataPropsStatus(classIri, 'Querying endpoint…')
        return fetchSchemaDataProperties(classIri, context, n3Store, 50, (msg) =>
          setDataPropsStatus(classIri, msg),
        )
      },
      dataPropsStatus,
    )
  }

  // ── Per-class descriptions ────────────────────────────────────────────────

  async function fetchDescription(
    classIri: string,
    context: QueryContext,
    n3Store: Store | undefined,
  ) {
    await withLoadingGuard(
      classIri,
      descriptionCache,
      descriptionLoading,
      () => {
        setDescriptionStatus(classIri, 'Fetching description…')
        return fetchClassDescription(classIri, context, n3Store)
      },
      descriptionStatus,
    )
  }

  // ── Per-class instances ───────────────────────────────────────────────────

  async function fetchInstances(
    classIri: string,
    context: QueryContext,
    n3Store: Store | undefined,
  ) {
    await withLoadingGuard(
      classIri,
      instancesCache,
      instancesLoading,
      () => fetchInstancesByClass(classIri, context, n3Store, 20),
      undefined,
      (items) => {
        if (items.length > 0) {
          const classLabel = nodes.value.find((n) => n.iri === classIri)?.label ?? ''
          const now = Date.now()
          cacheAdd(items.map((inst) => toEntityCacheEntry(inst, classIri, classLabel, now)))
        }
      },
    )
  }

  // ── Merge search results into instances cache ─────────────────────────────

  function mergeInstances(classIri: string, incoming: Array<{ iri: string; label: string }>) {
    if (incoming.length === 0) return
    const existing = instancesCache.value.get(classIri) ?? []
    const knownIris = new Set(existing.map((i) => i.iri))
    const novel = incoming.filter((i) => !knownIris.has(i.iri))
    if (novel.length === 0) return
    instancesCache.value.set(classIri, [...existing, ...novel])
    const classLabel = nodes.value.find((n) => n.iri === classIri)?.label ?? ''
    const now = Date.now()
    cacheAdd(novel.map((inst) => toEntityCacheEntry(inst, classIri, classLabel, now)))
  }

  // ── Per-instance entity properties ───────────────────────────────────────

  async function fetchEntityPropsForInstance(
    entityIri: string,
    context: QueryContext,
    n3Store: Store | undefined,
  ) {
    await withLoadingGuard(entityIri, entityPropsCache, entityPropsLoading, () =>
      fetchEntityProps(entityIri, context, n3Store),
    )
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
    // instances
    instancesCache,
    instancesLoading,
    fetchInstances,
    mergeInstances,
    // entity props
    entityPropsCache,
    entityPropsLoading,
    fetchEntityPropsForInstance,
  }
})
