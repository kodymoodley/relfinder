<template>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <!-- RouterView fills the full viewport; each view manages its own layout -->
  <!-- keep-alive preserves GraphView state (selected entities, graph result) across tab switches -->
  <RouterView v-slot="{ Component }">
    <keep-alive include="GraphView">
      <component :is="Component" />
    </keep-alive>
  </RouterView>
  <Toast position="bottom-right" />
  <CommandPalette v-model:visible="paletteVisible" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
import CommandPalette from '@/components/common/CommandPalette.vue'
import { useSchemaStore } from '@/stores/schema'
import { hooks, initEntityCache, cacheAll } from '@/lib/search/entityCache'
import { useSearchIndex } from '@/composables/useSearchIndex'
import { bootstrapFromSchema } from '@/lib/search/coldStartBootstrap'

const paletteVisible = ref(false)

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    paletteVisible.value = !paletteVisible.value
  }
}

const { add } = useSearchIndex()

// Forward all cache additions to the search index worker.
hooks.onAdd = add

onMounted(async () => {
  document.addEventListener('keydown', onGlobalKeydown)
  // Rehydrate IDB into _entities, then immediately forward persisted instances
  // (from previous sessions) to the search worker. Without this the worker
  // starts empty every page load and Ctrl+K never shows cached instances.
  await initEntityCache()
  const persisted = cacheAll()
  if (persisted.length > 0) add(persisted)
})
onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown))

const schemaStore = useSchemaStore()

// Seed the index once the first schema batch arrives (0 → N nodes).
watch(
  () => schemaStore.nodes.length,
  (newLen, oldLen) => {
    if (newLen > 0 && (oldLen ?? 0) === 0) {
      bootstrapFromSchema(schemaStore.nodes, schemaStore.edges, schemaStore.instancesCache)
    }
  },
)
</script>
