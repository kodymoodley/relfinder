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
    <div class="browse-body">
      <!-- Left panel: class list (populated in Task 3) -->
      <aside class="panel panel--classes">
        <p class="panel-placeholder">Classes panel — coming in Task 3</p>
      </aside>

      <!-- Right panel: pinned entities + history (populated in Tasks 5 & 6) -->
      <aside class="panel panel--pinned">
        <p class="panel-placeholder">Pinned entities — coming in Task 5</p>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useDarkMode } from '@/composables/useDarkMode'
import { useConnectionStore } from '@/stores/connection'

const router = useRouter()
const connectionStore = useConnectionStore()
const { dark, toggle: toggleDark } = useDarkMode()

function onDisconnect() {
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}
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
  display: grid;
  grid-template-columns: 1fr 320px;
  flex: 1;
  overflow: hidden;
  gap: 0;
}

.panel {
  overflow-y: auto;
  padding: var(--rf-space-5);
  border-right: 1px solid var(--rf-border);
}

.panel--pinned {
  border-right: none;
  background: var(--rf-surface);
}

.panel-placeholder {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-subtle);
  font-style: italic;
}
</style>
