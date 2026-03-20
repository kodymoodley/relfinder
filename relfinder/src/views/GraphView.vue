<template>
  <div class="graph-view">
    <!-- Sidebar: search + options — components added in Stage 2 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="app-brand">RelFinder</span>
        <button class="disconnect-btn" @click="onDisconnect">Disconnect</button>
      </div>
      <div class="sidebar-body">
        <p class="placeholder-note">
          Search panel coming in Stage 2.
        </p>
      </div>
    </aside>

    <!-- Main graph canvas — Cytoscape instance mounted here in Stage 2 -->
    <main class="graph-canvas" ref="canvasRef">
      <div class="canvas-placeholder">
        <span>Graph canvas — Stage 2</span>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConnectionStore } from '@/stores/connection'

const router = useRouter()
const connectionStore = useConnectionStore()
const canvasRef = ref<HTMLElement | null>(null)

function onDisconnect() {
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}
</script>

<style scoped>
.graph-view {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--rf-bg);
}

.sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--rf-surface);
  border-right: 1px solid var(--rf-border);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--rf-border);
}

.app-brand {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--rf-primary);
}

.disconnect-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--rf-border);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--rf-text-muted);
}

.disconnect-btn:hover {
  border-color: var(--rf-danger);
  color: var(--rf-danger);
}

.sidebar-body {
  flex: 1;
  padding: 1.25rem;
  overflow-y: auto;
}

.graph-canvas {
  flex: 1;
  position: relative;
}

.canvas-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--rf-text-muted);
  font-style: italic;
}

.placeholder-note {
  color: var(--rf-text-muted);
  font-style: italic;
  font-size: 0.9rem;
}
</style>
