<template>
  <div class="browse-view">
    <!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
    <aside class="sidebar" :class="{ 'sidebar--collapsed': sidebarCollapsed }">
      <div class="sidebar-header">
        <div v-show="!sidebarCollapsed" class="header-left">
          <span class="app-brand">RelFinder</span>
        </div>
        <div class="header-actions">
          <Button
            v-show="!sidebarCollapsed"
            :icon="dark ? 'pi pi-sun' : 'pi pi-moon'"
            text
            rounded
            size="small"
            @click="toggleDark"
            :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'"
          />
          <Button
            v-show="!sidebarCollapsed"
            icon="pi pi-power-off"
            text
            rounded
            size="small"
            severity="danger"
            @click="onDisconnect"
            aria-label="Disconnect"
            data-testid="disconnect-btn"
          />
          <Button
            icon="pi pi-bars"
            text
            rounded
            size="small"
            @click="sidebarCollapsed = !sidebarCollapsed"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          />
        </div>
      </div>

      <nav v-show="!sidebarCollapsed" class="sidebar-nav">
        <button class="view-tab view-tab--active" aria-current="page" data-testid="nav-schema">
          Schema
        </button>
        <button class="view-tab" @click="router.push({ name: 'graph' })" data-testid="nav-paths">
          Paths
        </button>
      </nav>

      <div v-show="!sidebarCollapsed" class="sidebar-body">
        <!-- Extract action — three exclusive states -->
        <section class="sidebar-section">
          <!-- State 1: no schema yet -->
          <Button
            v-if="!schemaStore.hasData && !schemaStore.extracting"
            label="Extract Schema"
            icon="pi pi-sitemap"
            severity="primary"
            fluid
            data-testid="extract-schema-btn"
            @click="startExtraction()"
          />

          <!-- State 2: actively extracting -->
          <Button
            v-else-if="schemaStore.extracting"
            label="Stop"
            icon="pi pi-spinner pi-spin"
            severity="danger"
            fluid
            data-testid="stop-extraction-btn"
            @click="schemaStore.cancel()"
          />

          <!-- State 3: done — unambiguous completion indicator -->
          <div v-else class="schema-done" data-testid="schema-done-indicator">
            <i class="pi pi-check-circle schema-done-icon" />
            <span class="schema-done-label">Schema loaded</span>
          </div>

          <Message
            v-if="schemaStore.extractError"
            severity="error"
            :closable="true"
            @close="schemaStore.extractError = ''"
            data-testid="extraction-error-msg"
          >
            {{ schemaStore.extractError }}
          </Message>
        </section>

        <!-- Extraction progress (only while extracting) -->
        <section
          v-if="schemaStore.extracting"
          class="sidebar-section"
          aria-live="polite"
          aria-atomic="false"
          data-testid="extraction-progress"
        >
          <div class="progress-row">
            <span class="progress-label">
              {{ schemaStore.statusMessage || 'Building edge map…' }}
            </span>
            <span v-if="schemaStore.progress.total > 0" class="progress-count">
              {{ schemaStore.progress.completed }} / {{ schemaStore.progress.total }}
            </span>
          </div>
          <ProgressBar
            v-if="schemaStore.progress.total > 0"
            :value="schemaStore.progressPct"
            :show-value="false"
            style="height: 4px"
          />
        </section>

        <!-- Stats -->
        <section
          v-if="schemaStore.nodes.length > 0"
          class="sidebar-section stats-row"
          data-testid="schema-stats"
        >
          <div class="stat-item">
            <span class="stat-value" data-testid="nodes-count">{{ schemaStore.nodes.length }}</span>
            <span class="stat-label">Classes</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" data-testid="edges-count">{{ schemaStore.edges.length }}</span>
            <span class="stat-label">Edges</span>
          </div>
        </section>

        <!-- Load more (SPARQL only — file sources extract all classes at once) -->
        <section v-if="canLoadMore && !connectionStore.isFileSource" class="sidebar-section">
          <Button
            :label="`Load next ${classLimit} classes`"
            icon="pi pi-plus-circle"
            severity="secondary"
            outlined
            size="small"
            fluid
            data-testid="load-more-btn"
            @click="onLoadMore"
          />
        </section>

        <!-- Options -->
        <Divider v-if="schemaStore.nodes.length > 0" />
        <section v-if="schemaStore.nodes.length > 0" class="sidebar-section">
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
              />
            </div>
            <div class="option-row">
              <label class="option-label" for="edge-limit">Props per class</label>
              <InputNumber
                id="edge-limit"
                v-model="edgeLimit"
                :min="5"
                :max="200"
                :step="5"
                size="small"
              />
            </div>
            <div class="option-row">
              <label class="option-label" for="hide-orphans">Hide orphan nodes</label>
              <ToggleButton
                v-model="schemaStore.hideOrphans"
                on-label="On"
                off-label="Off"
                on-icon="pi pi-check"
                off-icon="pi pi-times"
                size="small"
                data-testid="hide-orphans-toggle"
              />
            </div>
            <Button
              label="Re-extract"
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              size="small"
              fluid
              :disabled="schemaStore.extracting"
              data-testid="reextract-btn"
              @click="startExtraction(true)"
            />
          </template>
        </section>
      </div>
    </aside>

    <!-- ── Mobile backdrop ──────────────────────────────────────────────────────── -->
    <Transition name="backdrop">
      <div
        v-if="isMobile && !sidebarCollapsed"
        class="sidebar-backdrop"
        aria-hidden="true"
        @click="sidebarCollapsed = true"
      />
    </Transition>

    <!-- ── Schema canvas ──────────────────────────────────────────────────────── -->
    <main class="browse-main">
      <button
        v-if="isMobile && sidebarCollapsed"
        class="mobile-menu-btn"
        aria-label="Open menu"
        @click="sidebarCollapsed = false"
      >
        <i class="pi pi-bars" />
      </button>
      <SchemaCanvas
        :nodes="displayNodes"
        :edges="schemaStore.edges"
        :extracting="schemaStore.extracting"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
      />
    </main>

    <!-- ── Detail panel ────────────────────────────────────────────────────────── -->
    <SchemaDetailPanel
      :selected-node="selectedNode"
      :selected-edge="selectedEdge"
      :all-nodes="displayNodes"
      :all-edges="schemaStore.edges"
      @update:selected-node="selectedNode = $event"
      @update:selected-edge="selectedEdge = $event"
      @find-paths="onFindPaths"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Divider from 'primevue/divider'
import InputNumber from 'primevue/inputnumber'
import ToggleButton from 'primevue/togglebutton'
import { useDarkMode } from '@/composables/useDarkMode'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useConnectionStore } from '@/stores/connection'
import { useSchemaStore } from '@/stores/schema'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'
import SchemaCanvas from '@/components/schema/SchemaCanvas.vue'
import SchemaDetailPanel from '@/components/schema/SchemaDetailPanel.vue'

const router = useRouter()
const toast = useToast()
const connectionStore = useConnectionStore()
const schemaStore = useSchemaStore()
const { dark, toggle: toggleDark } = useDarkMode()
const { isMobile } = useBreakpoint()

// ── Local UI state ────────────────────────────────────────────────────────────

const selectedNode = ref<SchemaNode | null>(null)
const selectedEdge = ref<SchemaEdge | null>(null)
const sidebarCollapsed = ref(isMobile.value)
const optionsOpen = ref(false)

watch(isMobile, (mobile) => {
  if (mobile) sidebarCollapsed.value = true
})
const classLimit = ref(10)
const edgeLimit = ref(3)

// True when the last discovered batch was a full page — more classes likely exist
const canLoadMore = computed(
  () => !schemaStore.extracting && schemaStore.lastBatchSize >= classLimit.value,
)

const displayNodes = computed(() => {
  if (!schemaStore.hideOrphans) return schemaStore.nodes
  const connected = new Set<string>()
  for (const e of schemaStore.edges) {
    connected.add(e.sourceIri)
    connected.add(e.targetIri)
  }
  return schemaStore.nodes.filter((n) => connected.has(n.iri))
})

// ── Extraction ────────────────────────────────────────────────────────────────

function startExtraction(force = false) {
  selectedNode.value = null
  selectedEdge.value = null
  const context = connectionStore.queryContext ?? { endpointUrl: '' }
  const store = connectionStore.rdfStore ?? undefined
  // File sources are fully in-memory — fetch all classes at once.
  const effectiveClassLimit = connectionStore.isFileSource ? 10_000 : classLimit.value
  schemaStore.start(context, store, effectiveClassLimit, edgeLimit.value, force)
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

// ── Path finding navigation ───────────────────────────────────────────────────

function onFindPaths(
  start: { iri: string; label: string; class: string },
  end: { iri: string; label: string; class: string },
) {
  // Spread into plain objects — history.pushState cannot clone Vue Proxy objects.
  router.push({
    name: 'graph',
    state: {
      example: {
        entity1: { iri: start.iri, label: start.label },
        entity2: { iri: end.iri, label: end.label },
      },
    },
  })
}

// ── Load more ─────────────────────────────────────────────────────────────────

async function onLoadMore() {
  const before = schemaStore.nodes.length
  await schemaStore.loadMore()
  if (schemaStore.nodes.length === before) {
    toast.add({
      severity: 'info',
      summary: 'Schema complete',
      detail: 'All classes have already been extracted.',
      life: 4000,
    })
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

function onDisconnect() {
  schemaStore.clear()
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  if (connectionStore.isConnected && !schemaStore.hasData && !schemaStore.extracting) {
    startExtraction()
  }
})
</script>

<style scoped>
.browse-view {
  display: flex;
  height: 100dvh;
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
  gap: var(--rf-space-1);
  min-width: 0;
}

.sidebar-nav {
  display: flex;
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
}

.view-tab {
  flex: 1;
  min-height: 44px;
  padding: var(--rf-space-2) 0;
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--rf-text-muted);
  cursor: pointer;
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.view-tab:hover {
  color: var(--rf-text);
}

.view-tab--active {
  color: var(--rf-primary);
  border-bottom-color: var(--rf-primary);
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

.schema-done {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  border-radius: var(--rf-radius-md);
  background: color-mix(in srgb, var(--rf-success, #22c55e) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--rf-success, #22c55e) 30%, transparent);
}

.schema-done-icon {
  font-size: var(--rf-text-base);
  color: var(--rf-success, #22c55e);
  flex-shrink: 0;
}

.schema-done-label {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-success, #22c55e);
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
  flex-shrink: 0;
}

:deep(.option-row .p-inputnumber) {
  width: 72px;
}

:deep(.option-row .p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}

:deep(.option-row .p-togglebutton) {
  font-size: var(--rf-text-xs);
  padding: 0.3rem 0.7rem;
  width: 72px;
}

:deep(.option-row .p-togglebutton-checked) {
  background: var(--rf-primary-soft);
  border-color: var(--rf-primary);
  color: var(--rf-primary);
}

/* ── Main canvas ──────────────────────────────────────────────────────────── */

.browse-main {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* ── Responsive: mobile overlay drawer ───────────────────────────────────── */

@media (max-width: 767px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(280px, 85vw);
    transform: translateX(-100%);
    transition: transform var(--rf-duration-base) var(--rf-ease-out);
    z-index: 100;
  }

  .sidebar:not(.sidebar--collapsed) {
    transform: translateX(0);
  }

  /* On mobile the "collapsed" width shrinks to 52px on desktop — here it just
     stays off-screen so override width to fill the drawer width. */
  .sidebar--collapsed {
    width: min(280px, 85vw);
  }
}

/* ── Responsive: tablet+ — restore in-flow layout ───────────────────────── */

@media (min-width: 768px) {
  .sidebar {
    position: relative;
    width: 260px;
    transform: none !important;
    flex-shrink: 0;
    transition: width var(--rf-duration-base) var(--rf-ease-out);
  }

  .sidebar--collapsed {
    width: 52px;
  }

  .mobile-menu-btn {
    display: none;
  }
}

/* ── Backdrop ─────────────────────────────────────────────────────────────── */

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgb(0 0 0 / 0.45);
}

.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity var(--rf-duration-base) var(--rf-ease-out);
}

.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}

/* ── Mobile menu button ───────────────────────────────────────────────────── */

.mobile-menu-btn {
  position: absolute;
  top: var(--rf-space-3);
  left: var(--rf-space-3);
  z-index: 50;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--rf-radius-md);
  background: var(--rf-surface);
  color: var(--rf-text);
  box-shadow: var(--rf-shadow-md);
  cursor: pointer;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.mobile-menu-btn:hover {
  background: var(--rf-surface-raised);
}
</style>
