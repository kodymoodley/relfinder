import { ref, type Ref } from 'vue'
import type { EntitySearchResult, RelationshipGraph } from '@/lib/sparql/types'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import type { useConnectionStore } from '@/stores/connection'
import { findRelationships } from '@/lib/sparql/entitySearch'
import { fetchNeighbourhoodStore } from '@/lib/sparql/subgraphStrategy'
import { saveGraph } from '@/lib/cache/graphStorage'

export function useRelationshipSearch(
  entity1: Ref<EntitySearchResult | null>,
  entity2: Ref<EntitySearchResult | null>,
  graphOptions: Ref<GraphOptions>,
  connectionStore: ReturnType<typeof useConnectionStore>,
  endpointKey: () => string,
  onSearchStart: () => void,
  onSaved: () => void,
) {
  const graph = ref<RelationshipGraph | null>(null)
  const searching = ref(false)
  const searchError = ref('')

  async function onFindRelationships() {
    if (!entity1.value || !entity2.value) return

    searching.value = true
    searchError.value = ''
    graph.value = null
    onSearchStart()

    try {
      const context = connectionStore.queryContext
      const effectiveContext = context ?? { endpointUrl: '' }

      await connectionStore.waitForSubgraph()
      let store: import('n3').Store | undefined
      if (connectionStore.isFileSource) {
        store = connectionStore.rdfStore ?? undefined
      } else if (connectionStore.localRdfStore) {
        store = connectionStore.localRdfStore
      } else if (context) {
        store = await fetchNeighbourhoodStore(entity1.value.iri, entity2.value.iri, context)
      }

      graph.value = await findRelationships(
        entity1.value.iri,
        entity2.value.iri,
        graphOptions.value.maxDistance,
        effectiveContext,
        {
          ignoredProperties: graphOptions.value.ignoredProperties,
          avoidCycles: graphOptions.value.avoidCycles,
          language: graphOptions.value.language,
          store,
        },
      )

      if (graph.value.nodes.length === 0) {
        searchError.value =
          'No relationships found. Try increasing Max Depth, or select different entities.'
      } else {
        saveGraph(
          endpointKey(),
          entity1.value,
          entity2.value,
          graphOptions.value.maxDistance,
          graphOptions.value.ignoredProperties,
          graph.value,
        )
        onSaved()
      }
    } catch (err) {
      searchError.value =
        err instanceof Error
          ? `Query failed: ${err.message}`
          : 'An unexpected error occurred. Try again or check your network connection.'
    } finally {
      searching.value = false
    }
  }

  return { graph, searching, searchError, onFindRelationships }
}
