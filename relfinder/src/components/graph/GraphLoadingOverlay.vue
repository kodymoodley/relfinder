<template>
  <div class="canvas-loading">
    <ProgressSpinner stroke-width="2.5" style="width: 40px; height: 40px" />
    <p class="loading-title">Finding relationships</p>
    <div v-if="entity1Label && entity2Label" class="loading-entities">
      <span class="loading-entity">{{ entity1Label }}</span>
      <i class="pi pi-arrow-right loading-arrow" />
      <span class="loading-entity">{{ entity2Label }}</span>
    </div>
    <div class="loading-stages">
      <div
        v-for="(stage, i) in LOADING_STAGES"
        :key="i"
        :class="[
          'loading-stage',
          {
            'loading-stage--done': i < loadingStageIndex,
            'loading-stage--active': i === loadingStageIndex,
          },
        ]"
      >
        <span class="loading-stage-dot" />
        {{ stage }}
      </div>
    </div>
    <p class="loading-elapsed">{{ elapsedSeconds }}s elapsed</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import ProgressSpinner from 'primevue/progressspinner'

defineProps<{
  entity1Label?: string
  entity2Label?: string
}>()

const LOADING_STAGES = ['Querying endpoint', 'Traversing paths', 'Collecting results']
const elapsedSeconds = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null

const loadingStageIndex = computed(() => {
  if (elapsedSeconds.value < 3) return 0
  if (elapsedSeconds.value < 8) return 1
  return 2
})

onMounted(() => {
  elapsedSeconds.value = 0
  elapsedTimer = setInterval(() => {
    elapsedSeconds.value++
  }, 1000)
})

onUnmounted(() => {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
})
</script>
