<template>
  <div class="graph-view">
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
            data-testid="disconnect-btn-graph"
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
        <button
          class="view-tab"
          @click="router.push({ name: 'browse' })"
          data-testid="nav-schema-graph"
        >
          Schema
        </button>
        <button class="view-tab view-tab--active" aria-current="page" data-testid="nav-paths-graph">
          Paths
        </button>
      </nav>

      <div v-show="!sidebarCollapsed" class="sidebar-body">
        <!-- Entity selection -->
        <section class="sidebar-section" data-testid="entity1-search">
          <EntitySearch
            :key="`e1-${entitySearchKey}`"
            id="entity1"
            label="Source"
            placeholder="Search…"
            dot-color="#f97316"
            :allowed-classes="graphOptions.allowedClasses"
            :language="graphOptions.language"
            :custom-label-properties="graphOptions.customLabelProperties"
            :initial-entity="presetEntity1"
            @select="entity1 = $event"
          />
        </section>

        <section class="sidebar-section" data-testid="entity2-search">
          <EntitySearch
            :key="`e2-${entitySearchKey}`"
            id="entity2"
            label="Target"
            placeholder="Search…"
            dot-color="#8b5cf6"
            :allowed-classes="graphOptions.allowedClasses"
            :language="graphOptions.language"
            :custom-label-properties="graphOptions.customLabelProperties"
            :initial-entity="presetEntity2"
            @select="entity2 = $event"
          />
        </section>

        <!-- Find button -->
        <section class="sidebar-section">
          <Button
            label="Find Relationships"
            icon="pi pi-search"
            :loading="searching"
            :disabled="!entity1 || !entity2"
            :class="{ 'ready-pulse': entity1 && entity2 && !searching }"
            fluid
            data-testid="find-relationships-btn"
            @click="onFindRelationships"
          />
          <Message
            v-if="searchError"
            severity="error"
            :closable="true"
            :pt="{ root: { role: 'alert' } }"
            @close="searchError = ''"
          >
            {{ searchError }}
          </Message>
        </section>

        <!-- Recent graphs -->
        <section v-if="recentGraphs.length > 0" class="sidebar-section">
          <p class="section-label collapsible" @click="recentOpen = !recentOpen">
            <i :class="['pi', recentOpen ? 'pi-chevron-down' : 'pi-chevron-right']" />
            Recent ({{ recentGraphs.length }})
          </p>
          <ul v-if="recentOpen" class="recent-list">
            <li
              v-for="entry in recentGraphs"
              :key="entry.id"
              class="recent-item"
              @click="onLoadRecent(entry)"
            >
              <div class="recent-pair">
                <span class="recent-entity" :title="entry.entity1.label">{{
                  entry.entity1.label
                }}</span>
                <i class="pi pi-arrow-right recent-arrow" />
                <span class="recent-entity" :title="entry.entity2.label">{{
                  entry.entity2.label
                }}</span>
              </div>
              <div class="recent-meta">
                <Tag
                  :value="`${entry.maxDistance} hop${entry.maxDistance !== 1 ? 's' : ''}`"
                  severity="secondary"
                  class="recent-tag"
                />
                <button
                  class="recent-delete"
                  @click.stop="onDeleteRecent(entry.id)"
                  aria-label="Remove from recent"
                >
                  <i class="pi pi-times" />
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- Results summary -->
        <section
          v-if="graph"
          class="sidebar-section results-summary"
          v-motion
          :initial="{ opacity: 0, x: -12 }"
          :enter="{ opacity: 1, x: 0, transition: { duration: 300, ease: 'easeOut' } }"
        >
          <div class="summary-row">
            <span class="summary-label">Nodes</span>
            <Tag :value="String(graph.nodes.length)" severity="secondary" rounded />
          </div>
          <div class="summary-row">
            <span class="summary-label">Edges</span>
            <Tag :value="String(graph.edges.length)" severity="secondary" rounded />
          </div>
        </section>

        <!-- Legend -->
        <section
          v-if="displayClasses.length > 0"
          class="sidebar-section"
          v-motion
          :initial="{ opacity: 0, x: -12 }"
          :enter="{ opacity: 1, x: 0, transition: { duration: 300, delay: 60, ease: 'easeOut' } }"
        >
          <p class="section-label">Legend</p>
          <div class="legend">
            <div v-for="cls in displayClasses" :key="cls" class="legend-item">
              <span class="legend-dot" :style="{ background: classColors.get(cls) ?? '#94a3b8' }" />
              <span class="legend-label" :title="cls">{{ shortIri(cls) }}</span>
            </div>
          </div>
        </section>

        <!-- Options -->
        <Divider />
        <section class="sidebar-section">
          <p class="section-label collapsible" @click="optionsOpen = !optionsOpen">
            <i :class="['pi', optionsOpen ? 'pi-chevron-down' : 'pi-chevron-right']" />
            Graph Filters
          </p>
          <OptionsPanel
            v-if="optionsOpen"
            v-model="graphOptions"
            :available-languages="availableLanguages"
            :graph-classes="graph?.classes"
          />
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

    <!-- ── Graph canvas ─────────────────────────────────────────────────────── -->
    <main id="main-content" class="graph-main">
      <button
        v-if="isMobile && sidebarCollapsed"
        class="mobile-menu-btn"
        aria-label="Open menu"
        @click="sidebarCollapsed = false"
      >
        <i class="pi pi-bars" />
      </button>
      <GraphCanvas
        ref="graphCanvasRef"
        :nodes="displayNodes"
        :edges="displayEdges"
        :loading="searching"
        :class-colors="classColors"
        :endpoint1-iri="entity1?.iri"
        :endpoint2-iri="entity2?.iri"
        :entity1-label="entity1?.label"
        :entity2-label="entity2?.label"
        @node-click="selectedNode = $event"
      />
    </main>

    <!-- ── Node detail drawer ───────────────────────────────────────────────── -->
    <NodeDetail
      :node="selectedNode"
      :language="graphOptions.language"
      @update:node="selectedNode = $event"
    />

    <ShortcutsModal v-model:visible="showShortcuts" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useDarkMode } from '@/composables/useDarkMode'
import { useBreakpoint } from '@/composables/useBreakpoint'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useConnectionStore } from '@/stores/connection'
import { findRelationships, refreshGraphLabels } from '@/lib/sparql/entitySearch'
import { fetchNeighbourhoodStore } from '@/lib/sparql/subgraphStrategy'
import { cacheGet } from '@/lib/cache/queryCache'
import {
  saveGraph,
  loadGraph,
  lookupGraph,
  listRecentGraphs,
  deleteGraphEntry,
} from '@/lib/cache/graphStorage'
import type { GraphHistoryMeta } from '@/lib/cache/graphStorage'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import type { EntitySearchResult, RelationshipGraph, GraphNode } from '@/lib/sparql/types'
import EntitySearch from '@/components/graph/EntitySearch.vue'
import OptionsPanel from '@/components/graph/OptionsPanel.vue'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'
import NodeDetail from '@/components/graph/NodeDetail.vue'
import ShortcutsModal from '@/components/common/ShortcutsModal.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

const router = useRouter()
const connectionStore = useConnectionStore()
const { dark, toggle: toggleDark } = useDarkMode()
const { isMobile } = useBreakpoint()

// ── State ─────────────────────────────────────────────────────────────────────

// Read synchronously so EntitySearch receives preset values on first render.
const _historyExample = (history.state as Record<string, unknown>)?.example as
  | {
      entity1: EntitySearchResult
      entity2: EntitySearchResult
      options?: Partial<GraphOptions>
      cacheKey?: string
    }
  | undefined

const presetEntity1 = ref<EntitySearchResult | null>(_historyExample?.entity1 ?? null)
const presetEntity2 = ref<EntitySearchResult | null>(_historyExample?.entity2 ?? null)
const entity1 = ref<EntitySearchResult | null>(presetEntity1.value)
const entity2 = ref<EntitySearchResult | null>(presetEntity2.value)
const graph = ref<RelationshipGraph | null>(null)
const searching = ref(false)
const searchError = ref('')
const selectedNode = ref<GraphNode | null>(null)
const sidebarCollapsed = ref(isMobile.value)
const optionsOpen = ref(false)
const showShortcuts = ref(false)
const graphCanvasRef = ref<InstanceType<typeof GraphCanvas> | null>(null)

watch(isMobile, (mobile) => {
  if (mobile) sidebarCollapsed.value = true
})

useKeyboardShortcuts({
  zoomIn: () => graphCanvasRef.value?.zoomIn(),
  zoomOut: () => graphCanvasRef.value?.zoomOut(),
  fit: () => graphCanvasRef.value?.fitGraph(),
  layout: () => graphCanvasRef.value?.rerunLayout(),
  toggleLabels: () => graphCanvasRef.value?.toggleEdgeLabels(),
  help: () => {
    showShortcuts.value = true
  },
})

const recentOpen = ref(true)
const recentGraphs = ref<GraphHistoryMeta[]>([])
const entitySearchKey = ref(0)

const graphOptions = ref<GraphOptions>({
  maxDistance: 2,
  ignoredProperties: [
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://www.w3.org/2004/02/skos/core#subject',
  ],
  avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES,
  allowedClasses: [],
  hiddenClasses: [],
  language: '',
  customLabelProperties: [],
  ..._historyExample?.options,
})

// ── Class colour assignment ───────────────────────────────────────────────────

const PALETTE = [
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#a78bfa', // violet
  '#facc15', // yellow
  '#f472b6', // pink
  '#f87171', // red
  '#60a5fa', // blue
  '#a3e635', // lime
]

const classColors = ref(new Map<string, string>())

// ── Client-side display filtering ─────────────────────────────────────────────

const displayClasses = computed(() => {
  if (!graph.value) return []
  return graph.value.classes.filter((c) => !graphOptions.value.hiddenClasses.includes(c))
})

const displayNodes = computed(() => {
  if (!graph.value) return []
  const hidden = graphOptions.value.hiddenClasses
  if (hidden.length === 0) return graph.value.nodes
  return graph.value.nodes.filter((n) => !hidden.includes(n.class))
})

const displayEdges = computed(() => {
  if (!graph.value) return []
  if (graphOptions.value.hiddenClasses.length === 0) return graph.value.edges
  const visibleIds = new Set(displayNodes.value.map((n) => n.id))
  return graph.value.edges.filter((e) => visibleIds.has(e.sid) && visibleIds.has(e.tid))
})

const availableLanguages = computed(() => {
  if (!graph.value) return []
  const langs = new Set<string>()
  for (const entries of graph.value.allLabels.values()) {
    for (const entry of entries) langs.add(entry.lang)
  }
  return [...langs].sort()
})

watch(
  () => graph.value?.classes,
  (classes) => {
    if (!classes) return
    const map = new Map<string, string>()
    classes.forEach((cls, idx) => {
      map.set(cls, PALETTE[idx % PALETTE.length] ?? '#94a3b8')
    })
    classColors.value = map
  },
)

// ── Recent graphs ─────────────────────────────────────────────────────────────

function endpointKey(): string {
  return connectionStore.queryContext?.endpointUrl ?? '__file__'
}

function refreshRecent() {
  recentGraphs.value = listRecentGraphs(endpointKey())
}

async function onLoadRecent(entry: GraphHistoryMeta) {
  // Seed EntitySearch chips via initial-entity (unlocked after nextTick)
  presetEntity1.value = entry.entity1
  presetEntity2.value = entry.entity2
  entity1.value = entry.entity1
  entity2.value = entry.entity2
  entitySearchKey.value++

  // Unlock chips so the user can still change entities
  await nextTick()
  presetEntity1.value = null
  presetEntity2.value = null

  const restored = loadGraph(entry.id)
  if (!restored) {
    // TTL expired — re-query transparently
    onFindRelationships()
    return
  }

  graph.value = restored
  selectedNode.value = null
  searchError.value = ''
  refreshRecent()
}

function onDeleteRecent(id: string) {
  deleteGraphEntry(id)
  refreshRecent()
}

// ── Find relationships ────────────────────────────────────────────────────────

async function onFindRelationships() {
  if (!entity1.value || !entity2.value) return

  searching.value = true
  searchError.value = ''
  graph.value = null
  selectedNode.value = null

  try {
    const context = connectionStore.queryContext
    const effectiveContext = context ?? { endpointUrl: '' }

    // Resolve which N3 store to use for local query execution.
    // Wait for any in-progress probe/fetch to settle first.
    await connectionStore.waitForSubgraph()
    let store: import('n3').Store | undefined
    if (connectionStore.isFileSource) {
      store = connectionStore.rdfStore ?? undefined
    } else if (connectionStore.localRdfStore) {
      store = connectionStore.localRdfStore
    } else if (context) {
      // Large endpoint (> 50 000 triples) — fetch 2-hop neighbourhoods on demand.
      store = await fetchNeighbourhoodStore(entity1.value.iri, entity2.value.iri, context)
    }

    graph.value = await findRelationships(
      entity1.value.iri,
      entity2.value.iri,
      graphOptions.value.maxDistance,
      effectiveContext,
      {
        ignoredProperties: graphOptions.value.ignoredProperties,
        avoidCycles: graphOptions.value.avoidCycles,
        language: graphOptions.value.language,
        store,
      },
    )

    if (graph.value.nodes.length === 0) {
      searchError.value =
        'No relationships found. Try increasing Max Depth, or select different entities.'
    } else {
      // Persist for future sessions
      saveGraph(
        endpointKey(),
        entity1.value,
        entity2.value,
        graphOptions.value.maxDistance,
        graphOptions.value.ignoredProperties,
        graph.value,
      )
      refreshRecent()
    }
  } catch (err) {
    searchError.value =
      err instanceof Error
        ? `Query failed: ${err.message}`
        : 'An unexpected error occurred. Try again or check your network connection.'
  } finally {
    searching.value = false
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

function onDisconnect() {
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}

// ── Escape key closes mobile sidebar ─────────────────────────────────────────

function onEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isMobile.value && !sidebarCollapsed.value) {
    sidebarCollapsed.value = true
  }
}

onUnmounted(() => {
  document.removeEventListener('keydown', onEscKey)
})

// ── Auto-run when entities are preset (from browse or examples panel) ────────

onMounted(() => {
  document.addEventListener('keydown', onEscKey)
  refreshRecent()

  if (!_historyExample) return

  // 1. Session cache (fastest — avoids even a localStorage read)
  if (_historyExample.cacheKey) {
    const cached = cacheGet<RelationshipGraph>(_historyExample.cacheKey)
    if (cached) {
      graph.value = cached
      return
    }
  }

  // 2. Persistent localStorage cache
  if (entity1.value && entity2.value) {
    const restored = lookupGraph(
      endpointKey(),
      entity1.value.iri,
      entity2.value.iri,
      graphOptions.value.maxDistance,
      graphOptions.value.ignoredProperties,
    )
    if (restored) {
      graph.value = restored
      return
    }
  }

  // 3. Full query
  onFindRelationships()
})

// ── Re-run on options change ──────────────────────────────────────────────────

// Language-only change: re-apply labels from the stored allLabels map — no
// network calls needed since all language tags were fetched up front.
watch(
  () => graphOptions.value.language,
  (lang) => {
    if (graph.value) refreshGraphLabels(graph.value, lang)
  },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}
</script>

<style scoped>
.graph-view {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background: var(--rf-bg);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */

.sidebar {
  width: 300px;
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
  margin-bottom: var(--rf-space-2);
  gap: var(--rf-space-2);
  user-select: none;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.section-label.collapsible:hover {
  color: var(--rf-primary);
}

/* ── Results summary ──────────────────────────────────────────────────────── */

.results-summary {
  flex-direction: row;
  gap: var(--rf-space-4);
}

.summary-row {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.summary-label {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
}

/* ── Legend ───────────────────────────────────────────────────────────────── */

.legend {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--rf-radius-full);
  flex-shrink: 0;
  box-shadow:
    0 0 0 2px rgb(255 255 255 / 0.5),
    0 1px 3px rgb(0 0 0 / 0.15);
}

.legend-label {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Find Relationships pulse ─────────────────────────────────────────────── */

@keyframes ready-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--rf-primary) 70%, transparent);
  }
  50% {
    box-shadow: 0 0 0 10px color-mix(in srgb, var(--rf-primary) 0%, transparent);
  }
}

.ready-pulse {
  animation: ready-pulse 2s ease-in-out infinite;
}

/* ── Main graph area ──────────────────────────────────────────────────────── */

.graph-main {
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
    width: min(300px, 85vw);
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    transform: translateX(-100%);
    transition: transform var(--rf-duration-base) var(--rf-ease-out);
    z-index: 100;
  }

  .sidebar:not(.sidebar--collapsed) {
    transform: translateX(0);
  }

  .sidebar--collapsed {
    width: min(300px, 85vw);
  }
}

/* ── Responsive: tablet+ — restore in-flow layout ───────────────────────── */

@media (min-width: 768px) {
  .sidebar {
    position: relative;
    width: 300px;
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
  top: calc(var(--rf-space-3) + env(safe-area-inset-top, 0px));
  left: calc(var(--rf-space-3) + env(safe-area-inset-left, 0px));
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

/* ── Recent graphs ────────────────────────────────────────────────────────── */

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  border-radius: var(--rf-radius-md);
  border: 1px solid var(--rf-border);
  background: var(--rf-surface-alt);
  cursor: pointer;
  transition:
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.recent-item:hover {
  border-color: var(--rf-primary);
  background: var(--rf-primary-soft);
}

.recent-pair {
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.recent-entity {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
}

.recent-arrow {
  font-size: 0.55rem;
  color: var(--rf-text-muted);
  flex-shrink: 0;
}

.recent-meta {
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  flex-shrink: 0;
}

.recent-tag {
  font-size: 10px;
}

.recent-delete {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.6rem;
  display: flex;
  align-items: center;
  border-radius: var(--rf-radius-sm);
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.recent-delete:hover {
  color: var(--rf-danger);
  background: var(--rf-danger-soft);
}
</style>
