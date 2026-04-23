<template>
  <div class="pinned-panel">
    <div class="panel-header">
      <span class="panel-title">Pinned</span>
      <span class="panel-badge">{{ pinnedStore.pins.length }}/2</span>
    </div>

    <div v-if="pinnedStore.pins.length === 0" class="panel-empty">
      <i class="pi pi-bookmark empty-icon" />
      <p class="empty-text">Pin up to 2 entities from the class list to explore their relationship.</p>
    </div>

    <ul v-else class="pin-list">
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
        <button
          class="pin-remove"
          aria-label="Unpin"
          @click="pinnedStore.unpin(pin.iri)"
        >
          <i class="pi pi-times" />
        </button>
      </li>
    </ul>

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
      <p v-if="!pinnedStore.isFull" class="cta-hint">
        Pin one more entity to explore.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { usePinnedStore } from '@/stores/pinned'
import { shortIri } from '@/lib/utils/iri'

const DOT_COLORS = ['#f97316', '#8b5cf6'] as const

const router = useRouter()
const pinnedStore = usePinnedStore()

function onExplore() {
  const [p1, p2] = pinnedStore.pins
  if (!p1 || !p2) return

  pinnedStore.clear()

  router.push({
    name: 'graph',
    state: {
      example: {
        entity1: { iri: p1.iri, label: p1.label, class: p1.class },
        entity2: { iri: p2.iri, label: p2.label, class: p2.class },
        options: {},
      },
    },
  })
}
</script>

<style scoped>
.pinned-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  flex: 1;
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
  padding: var(--rf-space-4) var(--rf-space-4) var(--rf-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  border-top: 1px solid var(--rf-border);
  flex-shrink: 0;
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
}

.explore-btn--ready:hover {
  filter: brightness(1.08);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rf-primary) 30%, transparent);
}

@keyframes ready-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rf-primary) 60%, transparent); }
  50%       { box-shadow: 0 0 0 8px color-mix(in srgb, var(--rf-primary) 0%, transparent); }
}

.explore-btn--ready {
  animation: ready-pulse 2s ease-in-out infinite;
}

.explore-btn--ready:hover {
  animation: none;
}

.cta-hint {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  text-align: center;
}
</style>
