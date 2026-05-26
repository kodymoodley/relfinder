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

<style scoped>
.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-4);
  color: var(--rf-text-muted);
  text-align: center;
  padding: var(--rf-space-8);
  pointer-events: none;
}

.loading-title {
  margin: 0;
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-md);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-text);
  letter-spacing: -0.01em;
}

.loading-entities {
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  font-size: var(--rf-text-sm);
}

.loading-entity {
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-primary);
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loading-arrow {
  font-size: 0.65rem;
  color: var(--rf-text-subtle);
}

.loading-stages {
  display: flex;
  gap: var(--rf-space-5);
  align-items: center;
}

.loading-stage {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  opacity: 0.35;
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    color var(--rf-duration-base) var(--rf-ease-out);
}

.loading-stage--active {
  opacity: 1;
  color: var(--rf-primary);
}

.loading-stage--done {
  opacity: 0.6;
  color: var(--rf-text-muted);
}

.loading-stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

@keyframes stage-dot-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.7);
  }
}

.loading-stage--active .loading-stage-dot {
  animation: stage-dot-pulse 1s ease-in-out infinite;
}

.loading-elapsed {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  font-variant-numeric: tabular-nums;
}
</style>
