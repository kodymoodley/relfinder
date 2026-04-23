<template>
  <div class="browse-view">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <header class="browse-header">
      <div class="header-left">
        <Button
          icon="pi pi-arrow-left"
          text
          rounded
          size="small"
          aria-label="Back to connection"
          @click="router.push({ name: 'connection' })"
        />
        <span class="header-title">Entity Browser</span>
      </div>
      <div class="header-right">
        <Button
          label="Open graph"
          icon="pi pi-arrow-right"
          icon-pos="right"
          text
          size="small"
          aria-label="Skip to graph view"
          @click="router.push({ name: 'graph' })"
        />
        <Button
          :icon="dark ? 'pi pi-sun' : 'pi pi-moon'"
          text
          rounded
          size="small"
          @click="toggleDark"
          :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'"
        />
        <Button
          icon="pi pi-power-off"
          text
          rounded
          size="small"
          severity="danger"
          aria-label="Disconnect"
          @click="onDisconnect"
        />
      </div>
    </header>

    <!-- ── Body ───────────────────────────────────────────────────────────── -->
    <div ref="bodyEl" class="browse-body">
      <!-- Left panel: class list -->
      <aside class="panel panel--classes">
        <ClassesPanel />
      </aside>

      <!-- Draggable divider -->
      <div
        class="resize-handle"
        :class="{ 'resize-handle--dragging': dragging }"
        @mousedown.prevent="startDrag"
      >
        <span class="resize-grip" />
      </div>

      <!-- Right panel: pinned entities -->
      <aside class="panel panel--pinned" :style="{ width: rightWidth + 'px' }">
        <PinnedPanel />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useDarkMode } from '@/composables/useDarkMode'
import { useConnectionStore } from '@/stores/connection'
import ClassesPanel from '@/components/browse/ClassesPanel.vue'
import PinnedPanel from '@/components/browse/PinnedPanel.vue'

const router = useRouter()
const connectionStore = useConnectionStore()
const { dark, toggle: toggleDark } = useDarkMode()

function onDisconnect() {
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}

// ── Resize handle ─────────────────────────────────────────────────────────────

const RIGHT_MIN = 180
const RIGHT_MAX = 600
const RIGHT_DEFAULT = 320

const bodyEl = ref<HTMLElement | null>(null)
const rightWidth = ref(RIGHT_DEFAULT)
const dragging = ref(false)

let dragStartX = 0
let dragStartWidth = 0

function startDrag(e: MouseEvent) {
  dragging.value = true
  dragStartX = e.clientX
  dragStartWidth = rightWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e: MouseEvent) {
  const delta = dragStartX - e.clientX
  const containerWidth = bodyEl.value?.offsetWidth ?? window.innerWidth
  const max = Math.min(RIGHT_MAX, containerWidth - 200)
  rightWidth.value = Math.max(RIGHT_MIN, Math.min(max, dragStartWidth + delta))
}

function stopDrag() {
  dragging.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

onUnmounted(stopDrag)
</script>

<style scoped>
.browse-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--rf-bg);
}

/* ── Header ─────────────────────────────────────────────────────────────── */

.browse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rf-space-2) var(--rf-space-4);
  background: var(--rf-surface);
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
  min-height: 52px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
}

.header-title {
  font-family: var(--rf-font-display);
  font-weight: var(--rf-weight-bold);
  font-size: var(--rf-text-base);
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--rf-primary) 0%, var(--rf-accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Body ───────────────────────────────────────────────────────────────── */

.browse-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.panel {
  overflow: hidden;
  flex-shrink: 0;
}

.panel--classes {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 200px;
}

.panel--pinned {
  display: flex;
  flex-direction: column;
  background: var(--rf-surface);
}

/* ── Resize handle ───────────────────────────────────────────────────────── */

.resize-handle {
  width: 5px;
  flex-shrink: 0;
  background: var(--rf-border);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
  position: relative;
}

.resize-handle:hover,
.resize-handle--dragging {
  background: var(--rf-primary);
}

.resize-grip {
  width: 3px;
  height: 24px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--rf-text-subtle) 40%, transparent);
  pointer-events: none;
}

.resize-handle:hover .resize-grip,
.resize-handle--dragging .resize-grip {
  background: color-mix(in srgb, #fff 60%, transparent);
}
</style>
