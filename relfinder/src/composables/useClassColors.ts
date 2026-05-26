import { ref, watch, type Ref } from 'vue'
import type { RelationshipGraph } from '@/lib/sparql/types'

const PALETTE = [
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#a78bfa', // violet
  '#facc15', // yellow
  '#f472b6', // pink
  '#f87171', // red
  '#60a5fa', // blue
  '#a3e635', // lime
]

/**
 * Assigns a stable colour from PALETTE to each class in the graph.
 * classColors is reset whenever graph.classes changes (new search result).
 */
export function useClassColors(graph: Ref<RelationshipGraph | null>) {
  const classColors = ref(new Map<string, string>())

  watch(
    () => graph.value?.classes,
    (classes) => {
      if (!classes) return
      const map = new Map<string, string>()
      classes.forEach((cls, idx) => {
        map.set(cls, PALETTE[idx % PALETTE.length] ?? '#94a3b8')
      })
      classColors.value = map
    },
  )

  return { classColors }
}
