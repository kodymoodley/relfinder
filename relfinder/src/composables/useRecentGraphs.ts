import { ref } from 'vue'
import { listRecentGraphs, deleteGraphEntry } from '@/lib/cache/graphStorage'
import type { GraphHistoryMeta } from '@/lib/cache/graphStorage'
import type { useConnectionStore } from '@/stores/connection'

export function useRecentGraphs(connectionStore: ReturnType<typeof useConnectionStore>) {
  const recentOpen = ref(true)
  const recentGraphs = ref<GraphHistoryMeta[]>([])

  function endpointKey(): string {
    return connectionStore.queryContext?.endpointUrl ?? '__file__'
  }

  function refreshRecent() {
    recentGraphs.value = listRecentGraphs(endpointKey())
  }

  function onDeleteRecent(id: string) {
    deleteGraphEntry(id)
    refreshRecent()
  }

  return { recentOpen, recentGraphs, endpointKey, refreshRecent, onDeleteRecent }
}
