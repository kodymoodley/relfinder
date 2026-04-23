<template>
  <div class="pinned-panel">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="panel-header">
      <span class="panel-title">Pinned</span>
      <span class="panel-badge">{{ pinnedStore.pins.length }}/2</span>
    </div>

    <!-- ── Empty state ─────────────────────────────────────────────────────── -->
    <div v-if="pinnedStore.pins.length === 0 && pinnedStore.history.length === 0" class="panel-empty">
      <i class="pi pi-bookmark empty-icon" />
      <p class="empty-text">Pin up to 2 entities from the class list to explore their relationship.</p>
    </div>

    <!-- ── Pin list ─────────────────────────────────────────────────────────── -->
    <ul v-if="pinnedStore.pins.length > 0" class="pin-list">
      <li
        v-for="(pin, index) in pinnedStore.pins"
        :key="pin.iri"
        class="pin-item"
      >
        <i class="pi pi-circle-fill pin-dot" :style="{ color: DOT_COLORS[index] }" />
        <div class="pin-info">
          <span class="pin-label" :title="pin.iri">{{ pin.label }}</span>
          <span class="pin-class">{{ shortIri(pin.class) }}</span>
        </div>
        <button class="pin-remove" aria-label="Unpin" @click="pinnedStore.unpin(pin.iri)">
          <i class="pi pi-times" />
        </button>
      </li>
    </ul>

    <!-- ── Explore CTA ──────────────────────────────────────────────────────── -->
    <div v-if="pinnedStore.pins.length > 0" class="cta-section">
      <button
        class="explore-btn"
        :class="{ 'explore-btn--ready': pinnedStore.isFull }"
        :disabled="!pinnedStore.isFull"
        @click="onExplore"
      >
        <span>Explore relationship</span>
        <i class="pi pi-arrow-right" />
      </button>
      <p v-if="!pinnedStore.isFull" class="cta-hint">Pin one more entity to explore.</p>
    </div>

    <!-- ── Query options ──────────────────────────────────────────────────────── -->
    <div class="query-options-section">
      <button class="query-options-toggle" @click="optionsOpen = !optionsOpen">
        <span class="query-options-title">Query Options</span>
        <i class="pi toggle-chevron" :class="optionsOpen ? 'pi-chevron-down' : 'pi-chevron-right'" />
      </button>
      <QueryOptionsPanel v-if="optionsOpen" v-model="queryOptions" />
    </div>

    <!-- ── Pair history ──────────────────────────────────────────────────────── -->
    <div v-if="pinnedStore.history.length > 0" class="history-section">
      <div class="history-header">
        <span class="history-title">Recent</span>
        <button class="history-clear" @click="pinnedStore.history.splice(0)">Clear</button>
      </div>
      <ul class="history-list">
        <li
          v-for="pair in pinnedStore.history"
          :key="pair.exploredAt"
          class="history-item"
          :title="`${pair.entity1.iri} ↔ ${pair.entity2.iri}`"
          @click="onReExplore(pair)"
        >
          <div class="history-pair">
            <span class="history-label">{{ pair.entity1.label }}</span>
            <i class="pi pi-arrows-h history-arrow" />
            <span class="history-label">{{ pair.entity2.label }}</span>
          </div>
          <i class="pi pi-external-link history-link-icon" />
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ref, toRaw } from 'vue'
import { usePinnedStore } from '@/stores/pinned'
import { shortIri } from '@/lib/utils/iri'
import type { ExploredPair } from '@/stores/pinned'
import QueryOptionsPanel from './QueryOptionsPanel.vue'
import type { QueryConfig } from './QueryOptionsPanel.vue'
import { QueryCyclesStrategy } from '@/lib/sparql/types'

const DOT_COLORS = ['#f97316', '#8b5cf6'] as const

const router = useRouter()
const pinnedStore = usePinnedStore()

const optionsOpen = ref(false)
const queryOptions = ref<QueryConfig>({
  maxDistance: 2,
  ignoredProperties: [
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://www.w3.org/2004/02/skos/core#subject',
  ],
  avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES,
  customLabelProperties: [],
})

function navigateToGraph(pair: { entity1: { iri: string; label: string; class: string }; entity2: { iri: string; label: string; class: string } }) {
  router.push({
    name: 'graph',
    state: {
      example: {
        entity1: toRaw(pair.entity1),
        entity2: toRaw(pair.entity2),
        options: toRaw(queryOptions.value),
      },
    },
  })
}

function onExplore() {
  const [p1, p2] = pinnedStore.pins
  if (!p1 || !p2) return
  pinnedStore.recordPair(p1, p2)
  pinnedStore.clearPins()
  navigateToGraph({ entity1: p1, entity2: p2 })
}

function onReExplore(pair: ExploredPair) {
  navigateToGraph(pair)
}
</script>

<style scoped>
.pinned-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

/* ── Header ─────────────────────────────────────────────────────────────── */

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-4) var(--rf-space-5);
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
}

.panel-title {
  font-family: var(--rf-font-display);
  font-weight: var(--rf-weight-semibold);
  font-size: var(--rf-text-sm);
  letter-spacing: -0.01em;
  color: var(--rf-text);
}

.panel-badge {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.5rem;
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-3);
  flex: 1;
  padding: var(--rf-space-8) var(--rf-space-5);
  text-align: center;
}

.empty-icon {
  font-size: 1.25rem;
  color: var(--rf-text-subtle);
}

.empty-text {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  line-height: var(--rf-leading-relaxed);
}

/* ── Pin list ────────────────────────────────────────────────────────────── */

.pin-list {
  list-style: none;
  margin: 0;
  padding: var(--rf-space-3) 0 0;
}

.pin-item {
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  padding: var(--rf-space-2) var(--rf-space-4);
}

.pin-dot {
  font-size: 0.55rem;
  flex-shrink: 0;
}

.pin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pin-label {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-class {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-remove {
  background: none;
  border: none;
  padding: var(--rf-space-1);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  border-radius: var(--rf-radius-full);
  flex-shrink: 0;
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.pin-remove:hover {
  color: var(--rf-danger);
  background: var(--rf-danger-soft);
}

/* ── CTA ─────────────────────────────────────────────────────────────────── */

.cta-section {
  padding: var(--rf-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  border-top: 1px solid var(--rf-border);
}

.explore-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-4);
  border-radius: var(--rf-radius-md);
  border: 1px solid var(--rf-border);
  background: var(--rf-surface-raised);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-muted);
  cursor: not-allowed;
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out),
    box-shadow var(--rf-duration-fast) var(--rf-ease-out);
}

.explore-btn--ready {
  background: var(--rf-primary);
  border-color: var(--rf-primary);
  color: #fff;
  cursor: pointer;
  animation: ready-pulse 2s ease-in-out infinite;
}

.explore-btn--ready:hover {
  filter: brightness(1.08);
  animation: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rf-primary) 30%, transparent);
}

@keyframes ready-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rf-primary) 60%, transparent); }
  50%       { box-shadow: 0 0 0 8px color-mix(in srgb, var(--rf-primary) 0%, transparent); }
}

.cta-hint {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  text-align: center;
}

/* ── Query options ───────────────────────────────────────────────────────── */

.query-options-section {
  border-top: 1px solid var(--rf-border);
}

.query-options-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rf-space-3) var(--rf-space-5);
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--rf-font-body);
}

.query-options-toggle:hover .query-options-title {
  color: var(--rf-primary);
}

.query-options-title {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.toggle-chevron {
  font-size: 0.55rem;
  color: var(--rf-text-subtle);
}

/* ── History ─────────────────────────────────────────────────────────────── */

.history-section {
  border-top: 1px solid var(--rf-border);
  padding-top: var(--rf-space-1);
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rf-space-3) var(--rf-space-5) var(--rf-space-1);
}

.history-title {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.history-clear {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  font-family: var(--rf-font-body);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.history-clear:hover {
  color: var(--rf-danger);
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0 0 var(--rf-space-3);
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-4);
  cursor: pointer;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.history-item:hover {
  background: var(--rf-surface-raised);
}

.history-item:hover .history-link-icon {
  opacity: 1;
}

.history-pair {
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.history-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}

.history-arrow {
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
  flex-shrink: 0;
}

.history-link-icon {
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--rf-duration-fast) var(--rf-ease-out);
}
</style>
