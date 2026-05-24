<template>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <!-- RouterView fills the full viewport; each view manages its own layout -->
  <RouterView />
  <Toast position="bottom-right" />
  <CommandPalette v-model:visible="paletteVisible" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
import CommandPalette from '@/components/common/CommandPalette.vue'
import { useSchemaStore } from '@/stores/schema'
import { hooks } from '@/lib/search/entityCache'
import { useSearchIndex } from '@/composables/useSearchIndex'
import { bootstrapFromSchema } from '@/lib/search/coldStartBootstrap'

const paletteVisible = ref(false)

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    paletteVisible.value = !paletteVisible.value
  }
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown))

const schemaStore = useSchemaStore()
const { add } = useSearchIndex()

// Forward all cache additions to the search index worker.
hooks.onAdd = add

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
