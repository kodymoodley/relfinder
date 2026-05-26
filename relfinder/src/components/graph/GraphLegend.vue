<template>
  <Transition name="legend-fade">
    <div
      v-if="entries.length >= 2"
      ref="legendRef"
      class="graph-legend"
      :style="legendPos ? { left: legendPos.left + 'px', top: legendPos.top + 'px' } : {}"
      role="complementary"
      aria-label="Node class legend"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @click.capture="onClickCapture"
    >
      <button
        class="legend-toggle"
        :aria-expanded="!collapsed"
        aria-controls="graph-legend-list"
        @click="collapsed = !collapsed"
      >
        <span class="legend-title">Legend</span>
        <i :class="['pi', collapsed ? 'pi-chevron-down' : 'pi-chevron-up']" />
      </button>
      <ul v-if="!collapsed" id="graph-legend-list" class="legend-list">
        <li v-for="entry in entries" :key="entry.iri" class="legend-item">
          <span class="legend-swatch" :style="{ background: entry.color }" aria-hidden="true" />
          <span class="legend-label" :title="entry.iri">{{ entry.label }}</span>
        </li>
      </ul>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  entries: Array<{ iri: string; label: string; color: string }>
}>()

const legendRef = ref<HTMLDivElement | null>(null)
const legendPos = ref<{ left: number; top: number } | null>(null)
const collapsed = ref(false)

let _dragStartX = 0
let _dragStartY = 0
let _elemStartLeft = 0
let _elemStartTop = 0
let _moved = false

function onPointerDown(e: PointerEvent): void {
  const el = legendRef.value
  if (!el) return
  const toggle = el.querySelector('.legend-toggle')
  if (toggle?.contains(e.target as Node)) return
  const containerRect = el.parentElement!.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  _dragStartX = e.clientX
  _dragStartY = e.clientY
  _elemStartLeft = legendPos.value?.left ?? rect.left - containerRect.left
  _elemStartTop = legendPos.value?.top ?? rect.top - containerRect.top
  _moved = false
  el.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  const el = legendRef.value
  if (!el || !el.hasPointerCapture(e.pointerId)) return
  const dx = e.clientX - _dragStartX
  const dy = e.clientY - _dragStartY
  if (!_moved && Math.hypot(dx, dy) < 5) return
  _moved = true
  const container = el.parentElement!
  legendPos.value = {
    left: Math.max(0, Math.min(_elemStartLeft + dx, container.clientWidth - el.offsetWidth)),
    top: Math.max(0, Math.min(_elemStartTop + dy, container.clientHeight - el.offsetHeight)),
  }
}

function onClickCapture(e: MouseEvent): void {
  if (_moved) e.stopPropagation()
}
</script>

<style scoped>
.graph-legend {
  position: absolute;
  top: var(--rf-space-4);
  left: var(--rf-space-4);
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  box-shadow: var(--rf-shadow-sm);
  padding: var(--rf-space-2) var(--rf-space-3);
  min-width: 120px;
  max-width: 180px;
  z-index: 5;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.legend-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  gap: var(--rf-space-2);
  min-height: 32px;
}

.legend-title {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.legend-toggle .pi {
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
}

.legend-list {
  list-style: none;
  margin: var(--rf-space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-fade-enter-active,
.legend-fade-leave-active {
  transition: opacity var(--rf-duration-base) var(--rf-ease-out);
}
.legend-fade-enter-from,
.legend-fade-leave-to {
  opacity: 0;
}
</style>
