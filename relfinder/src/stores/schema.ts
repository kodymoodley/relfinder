import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import type { SchemaNode, SchemaEdge, QueryContext } from '@/lib/sparql/types'
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
  }

  return { nodes, edges, extracting, extractError, progress, progressPct, hasData, start, cancel, clear }
})
