<template>
  <div class="browse-view">
    <!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
    <aside class="sidebar" :class="{ 'sidebar--collapsed': sidebarCollapsed }">
      <div class="sidebar-header">
        <div v-show="!sidebarCollapsed" class="header-left">
          <span class="app-brand">RelFinder</span>
          <div class="view-tabs">
            <button class="view-tab view-tab--active" aria-current="page">Schema</button>
            <button class="view-tab" @click="router.push({ name: 'graph' })">Relations</button>
          </div>
        </div>
        <div class="header-actions">
          <Button
            v-show="!sidebarCollapsed"
            :icon="dark ? 'pi pi-sun' : 'pi pi-moon'"
            text rounded size="small"
            @click="toggleDark"
            :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'"
          />
          <Button
            v-show="!sidebarCollapsed"
            icon="pi pi-power-off"
            text rounded size="small"
            severity="danger"
            @click="onDisconnect"
            aria-label="Disconnect"
          />
          <Button
            icon="pi pi-bars"
            text rounded size="small"
            @click="sidebarCollapsed = !sidebarCollapsed"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          />
        </div>
      </div>

      <div v-show="!sidebarCollapsed" class="sidebar-body">
        <!-- Extract action -->
        <section class="sidebar-section">
          <Button
            :label="extracting ? 'Stop extraction' : 'Extract Schema'"
            :icon="extracting ? 'pi pi-stop' : 'pi pi-sitemap'"
            :severity="extracting ? 'danger' : 'primary'"
            :loading="extracting && progress.total === 0"
            fluid
            @click="extracting ? cancelExtraction() : startExtraction()"
          />
          <Message v-if="extractError" severity="error" :closable="true" @close="extractError = ''">
            {{ extractError }}
          </Message>
        </section>

        <!-- Progress -->
        <section v-if="extracting && progress.total > 0" class="sidebar-section">
          <div class="progress-row">
            <span class="progress-label">Phase 2 — edges</span>
            <span class="progress-count">{{ progress.completed }} / {{ progress.total }}</span>
          </div>
          <ProgressBar :value="progressPct" :show-value="false" style="height: 4px" />
        </section>

        <!-- Stats -->
        <section v-if="nodes.length > 0" class="sidebar-section stats-row">
          <div class="stat-item">
            <span class="stat-value">{{ nodes.length }}</span>
            <span class="stat-label">Classes</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ edges.length }}</span>
            <span class="stat-label">Edges</span>
          </div>
        </section>

        <!-- Options -->
        <Divider v-if="nodes.length > 0" />
        <section v-if="nodes.length > 0" class="sidebar-section">
          <p class="section-label collapsible" @click="optionsOpen = !optionsOpen">
            <i :class="['pi', optionsOpen ? 'pi-chevron-down' : 'pi-chevron-right']" />
            Options
          </p>
          <template v-if="optionsOpen">
            <div class="option-row">
              <label class="option-label" for="class-limit">Class limit</label>
              <InputNumber
                id="class-limit"
                v-model="classLimit"
                :min="10"
                :max="500"
                :step="10"
                size="small"
                style="width: 80px"
              />
            </div>
            <div class="option-row">
              <label class="option-label" for="edge-limit">Edges / class</label>
              <InputNumber
                id="edge-limit"
                v-model="edgeLimit"
                :min="5"
                :max="200"
                :step="5"
                size="small"
                style="width: 80px"
              />
            </div>
          </template>
        </section>
      </div>
    </aside>

    <!-- ── Schema canvas ──────────────────────────────────────────────────────── -->
    <main class="browse-main">
      <SchemaCanvas
        :nodes="nodes"
        :edges="edges"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
      />
    </main>

    <!-- ── Detail panel ────────────────────────────────────────────────────────── -->
    <SchemaDetailPanel
      :selected-node="selectedNode"
      :selected-edge="selectedEdge"
      :all-nodes="nodes"
      :all-edges="edges"
      @update:selected-node="selectedNode = $event"
      @update:selected-edge="selectedEdge = $event"
      @explore="onExplore"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Divider from 'primevue/divider'
import InputNumber from 'primevue/inputnumber'
import { useDarkMode } from '@/composables/useDarkMode'
import { useConnectionStore } from '@/stores/connection'
import { extractSchema } from '@/lib/sparql/schemaExtractor'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'
import SchemaCanvas from '@/components/schema/SchemaCanvas.vue'
import SchemaDetailPanel from '@/components/schema/SchemaDetailPanel.vue'

const router = useRouter()
const connectionStore = useConnectionStore()
const { dark, toggle: toggleDark } = useDarkMode()

// ── State ─────────────────────────────────────────────────────────────────────

const nodes = ref<SchemaNode[]>([])
const edges = ref<SchemaEdge[]>([])
const extracting = ref(false)
const extractError = ref('')
const progress = ref({ completed: 0, total: 0 })
const selectedNode = ref<SchemaNode | null>(null)
const selectedEdge = ref<SchemaEdge | null>(null)
const sidebarCollapsed = ref(false)
const optionsOpen = ref(false)
const classLimit = ref(100)
const edgeLimit = ref(50)

let abortController: AbortController | null = null

const progressPct = computed(() =>
  progress.value.total > 0
    ? Math.round((progress.value.completed / progress.value.total) * 100)
    : 0,
)

// ── Extraction ────────────────────────────────────────────────────────────────

async function startExtraction() {
  abortController = new AbortController()

  nodes.value = []
  edges.value = []
  extractError.value = ''
  progress.value = { completed: 0, total: 0 }
  selectedNode.value = null
  selectedEdge.value = null
  extracting.value = true

  try {
    const context = connectionStore.queryContext
    const store = connectionStore.rdfStore ?? undefined
    const effectiveContext = context ?? { endpointUrl: '' }

    await extractSchema(
      effectiveContext,
      store,
      { classLimit: classLimit.value, edgeLimit: edgeLimit.value },
      {
        onClassesLoaded(incoming) {
          nodes.value = incoming
          progress.value = { completed: 0, total: incoming.length }
        },
        onEdgesLoaded(incoming) {
          edges.value = [...edges.value, ...incoming]
        },
        onProgress(completed, total) {
          progress.value = { completed, total }
        },
      },
      abortController.signal,
    )
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      extractError.value =
        err instanceof Error ? `Extraction failed: ${err.message}` : 'An unexpected error occurred.'
    }
  } finally {
    extracting.value = false
  }
}

function cancelExtraction() {
  abortController?.abort()
}

// ── Node / edge selection ─────────────────────────────────────────────────────

function onNodeClick(node: SchemaNode) {
  selectedEdge.value = null
  selectedNode.value = node
}

function onEdgeClick(edge: SchemaEdge) {
  selectedNode.value = null
  selectedEdge.value = edge
}

// ── Navigate to Graph View ────────────────────────────────────────────────────

function onExplore(sourceIri: string, targetIri: string) {
  const sourceNode = nodes.value.find((n) => n.iri === sourceIri)
  const targetNode = nodes.value.find((n) => n.iri === targetIri)
  router.push({
    name: 'graph',
    state: {
      example: {
        entity1: { iri: sourceIri, label: sourceNode?.label ?? sourceIri, class: sourceIri },
        entity2: { iri: targetIri, label: targetNode?.label ?? targetIri, class: targetIri },
      },
    },
  })
}

// ── Disconnect ────────────────────────────────────────────────────────────────

function onDisconnect() {
  abortController?.abort()
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  if (connectionStore.isConnected) startExtraction()
})

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
.browse-view {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--rf-bg);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */

.sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--rf-surface);
  border-right: 1px solid var(--rf-border);
  transition: width var(--rf-duration-base) var(--rf-ease-out);
  overflow: hidden;
  box-shadow: var(--rf-shadow-md);
  z-index: 10;
}

.sidebar--collapsed {
  width: 52px;
}

.sidebar--collapsed .sidebar-header {
  justify-content: flex-end;
  padding-inline: var(--rf-space-2);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rf-space-3) var(--rf-space-4);
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
  min-height: 52px;
  background: linear-gradient(135deg, var(--rf-surface) 0%, var(--rf-surface-raised) 100%);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  min-width: 0;
}

.view-tabs {
  display: flex;
  gap: 2px;
  background: var(--rf-surface-alt);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  padding: 2px;
}

.view-tab {
  padding: 2px 10px;
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  border-radius: calc(var(--rf-radius-md) - 2px);
  border: none;
  background: transparent;
  color: var(--rf-text-muted);
  cursor: pointer;
  transition: background var(--rf-duration-fast) var(--rf-ease-out),
              color var(--rf-duration-fast) var(--rf-ease-out);
  white-space: nowrap;
}

.view-tab:hover {
  color: var(--rf-text);
  background: var(--rf-surface-raised);
}

.view-tab--active {
  background: var(--rf-primary);
  color: #fff;
}

.view-tab--active:hover {
  background: var(--rf-primary-hover);
  color: #fff;
}

.app-brand {
  font-family: var(--rf-font-display);
  font-weight: var(--rf-weight-bold);
  font-size: var(--rf-text-lg);
  letter-spacing: -0.02em;
  white-space: nowrap;
  background: linear-gradient(135deg, var(--rf-primary) 0%, var(--rf-accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-actions {
  display: flex;
  gap: var(--rf-space-1);
  flex-shrink: 0;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--rf-space-3) 0;
}

.sidebar-section {
  padding: var(--rf-space-3) var(--rf-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.section-label {
  margin: 0;
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.section-label.collapsible {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  user-select: none;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.section-label.collapsible:hover {
  color: var(--rf-primary);
}

/* ── Progress ─────────────────────────────────────────────────────────────── */

.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
}

.progress-count {
  font-size: var(--rf-text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--rf-text-subtle);
}

/* ── Stats ────────────────────────────────────────────────────────────────── */

.stats-row {
  flex-direction: row;
  gap: var(--rf-space-6);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-xl);
  font-weight: var(--rf-weight-bold);
  color: var(--rf-primary);
  line-height: 1;
}

.stat-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
}

/* ── Options ──────────────────────────────────────────────────────────────── */

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-3);
}

.option-label {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
}

/* ── Main canvas ──────────────────────────────────────────────────────────── */

.browse-main {
  flex: 1;
  position: relative;
  overflow: hidden;
}
</style>
