import { computed, watch, type Ref } from 'vue'
import type { RelationshipGraph } from '@/lib/sparql/types'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import { refreshGraphLabels } from '@/lib/sparql/entitySearch'

/**
 * Derives client-side display collections from a relationship graph and the
 * current filter options. Also owns the language-switch side effect
 * (refreshGraphLabels), which re-applies labels in-place without a network call.
 */
export function useGraphFilters(
  graph: Ref<RelationshipGraph | null>,
  graphOptions: Ref<GraphOptions>,
) {
  const displayClasses = computed(() => {
    if (!graph.value) return []
    return graph.value.classes.filter((c) => !graphOptions.value.hiddenClasses.includes(c))
  })

  const displayNodes = computed(() => {
    if (!graph.value) return []
    const hidden = graphOptions.value.hiddenClasses
    if (hidden.length === 0) return graph.value.nodes
    return graph.value.nodes.filter((n) => !hidden.includes(n.class))
  })

  const displayEdges = computed(() => {
    if (!graph.value) return []
    if (graphOptions.value.hiddenClasses.length === 0) return graph.value.edges
    const visibleIds = new Set(displayNodes.value.map((n) => n.id))
    return graph.value.edges.filter((e) => visibleIds.has(e.sid) && visibleIds.has(e.tid))
  })

  const availableLanguages = computed(() => {
    if (!graph.value) return []
    const langs = new Set<string>()
    for (const entries of graph.value.allLabels.values()) {
      for (const entry of entries) langs.add(entry.lang)
    }
    return [...langs].sort()
  })

  // Language-only change: re-apply labels from the stored allLabels map — no
  // network calls needed since all language tags were fetched up front.
  watch(
    () => graphOptions.value.language,
    (lang) => {
      if (graph.value) refreshGraphLabels(graph.value, lang)
    },
  )

  return { displayClasses, displayNodes, displayEdges, availableLanguages }
}
