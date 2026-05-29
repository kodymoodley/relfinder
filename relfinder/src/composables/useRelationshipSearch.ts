import { ref, type Ref } from 'vue'
import type { EntitySearchResult, RelationshipGraph } from '@/lib/sparql/types'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import type { useConnectionStore } from '@/stores/connection'
import { findRelationships } from '@/lib/sparql/entitySearch'
import { fetchNeighbourhoodStore } from '@/lib/sparql/subgraphStrategy'
import { SparqlClient } from '@/lib/sparql/client'
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
      console.log('[useRelationshipSearch] entity IRIs:', entity1.value.iri, entity2.value.iri)

      await connectionStore.waitForSubgraph()

      // Resolve the store to run path-finding queries against.
      // Priority: local file store → full cached graph → on-demand neighbourhood.
      let client = connectionStore.sparqlClient
      if (!client) throw new Error('No active connection')

      if (!client.isFileSource) {
        if (connectionStore.localRdfStore) {
          // Small endpoint: full graph was fetched at connect time — wrap it.
          client = new SparqlClient({ endpointUrl: '' }, connectionStore.localRdfStore)
        } else {
          // Large endpoint: fetch 2-hop neighbourhoods around the two entities.
          console.log('[useRelationshipSearch] calling fetchNeighbourhoodStore')
          const neighbourStore = await fetchNeighbourhoodStore(
            entity1.value.iri,
            entity2.value.iri,
            client,
          )
          console.log(
            '[useRelationshipSearch] fetchNeighbourhoodStore done, store size:',
            neighbourStore.size,
          )
          client = new SparqlClient({ endpointUrl: '' }, neighbourStore)
        }
      }

      graph.value = await findRelationships(
        entity1.value.iri,
        entity2.value.iri,
        graphOptions.value.maxDistance,
        client,
        {
          ignoredProperties: graphOptions.value.ignoredProperties,
          avoidCycles: graphOptions.value.avoidCycles,
          language: graphOptions.value.language,
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
