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
