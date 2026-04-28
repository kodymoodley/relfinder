import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { extractSchema, fetchSchemaDataProperties } from '@/lib/sparql/schemaExtractor'
import type { SchemaNode, SchemaEdge, SchemaDataProp, QueryContext } from '@/lib/sparql/types'
import type { Store } from 'n3'

export const useSchemaStore = defineStore('schema', () => {
  const nodes = ref<SchemaNode[]>([])
  const edges = ref<SchemaEdge[]>([])
  const extracting = ref(false)
  const extractError = ref('')
  const progress = ref({ completed: 0, total: 0 })

  let abortController: AbortController | null = null

  const progressPct = computed(() =>
    progress.value.total > 0
      ? Math.round((progress.value.completed / progress.value.total) * 100)
      : 0,
  )

  const hasData = computed(() => nodes.value.length > 0)

  const hideOrphans = ref(false)

  const dataPropsCache = ref(new Map<string, SchemaDataProp[]>())
  const dataPropsLoading = ref(new Set<string>())
  const dataPropsStatus = ref(new Map<string, string>())

  async function start(
    context: QueryContext,
    store: Store | undefined,
    classLimit: number,
    edgeLimit: number,
  ) {
    abortController = new AbortController()

    nodes.value = []
    edges.value = []
    extractError.value = ''
    progress.value = { completed: 0, total: 0 }
    extracting.value = true

    try {
      await extractSchema(
        context,
        store,
        { classLimit, edgeLimit },
        {
          onClassesLoaded(incoming) {
            nodes.value = incoming
            progress.value = { completed: 0, total: incoming.length }
          },
          onEdgesLoaded(incoming) {
            edges.value = [...edges.value, ...incoming]
          },
          onProgress(completed, total) {
            progress.value = { completed, total }
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
    }
  }

  function setStatus(classIri: string, msg: string) {
    dataPropsStatus.value = new Map(dataPropsStatus.value).set(classIri, msg)
  }

  async function fetchDataProps(classIri: string, context: QueryContext, store: Store | undefined) {
    if (dataPropsCache.value.has(classIri)) return
    if (dataPropsLoading.value.has(classIri)) return

    dataPropsLoading.value = new Set(dataPropsLoading.value).add(classIri)
    setStatus(classIri, 'Querying endpoint…')

    try {
      const props = await fetchSchemaDataProperties(classIri, context, store, 50, (msg) => setStatus(classIri, msg))
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
    dataPropsCache.value = new Map()
    dataPropsLoading.value = new Set()
    dataPropsStatus.value = new Map()
  }

  return {
    nodes, edges, extracting, extractError, progress, progressPct, hasData,
    hideOrphans, dataPropsCache, dataPropsLoading, dataPropsStatus,
    start, cancel, clear, fetchDataProps,
  }
})
