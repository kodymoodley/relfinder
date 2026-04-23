<template>
  <div class="graph-view">
    <!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
    <aside class="sidebar" :class="{ 'sidebar--collapsed': sidebarCollapsed }">
      <div class="sidebar-header">
        <div v-show="!sidebarCollapsed" class="header-left">
          <Button
            icon="pi pi-arrow-left"
            text
            rounded
            size="small"
            aria-label="Back to browser"
            @click="router.push({ name: 'browse' })"
          />
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

      <div v-show="!sidebarCollapsed" class="sidebar-body">
        <!-- Entity selection -->
        <section class="sidebar-section">
          <EntitySearch
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

        <section class="sidebar-section">
          <EntitySearch
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
            @click="onFindRelationships"
          />
          <Message v-if="searchError" severity="error" :closable="true" @close="searchError = ''">
            {{ searchError }}
          </Message>
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
            Query Options
          </p>
          <OptionsPanel v-if="optionsOpen" v-model="graphOptions" :available-languages="availableLanguages" :graph-classes="graph?.classes" />
        </section>
      </div>
    </aside>

    <!-- ── Graph canvas ─────────────────────────────────────────────────────── -->
    <main class="graph-main">
      <GraphCanvas
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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useDarkMode } from '@/composables/useDarkMode'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useConnectionStore } from '@/stores/connection'
import { findRelationships, refreshGraphLabels } from '@/lib/sparql/entitySearch'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import type { EntitySearchResult, RelationshipGraph, GraphNode } from '@/lib/sparql/types'
import EntitySearch from '@/components/graph/EntitySearch.vue'
import OptionsPanel from '@/components/graph/OptionsPanel.vue'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'
import NodeDetail from '@/components/graph/NodeDetail.vue'

const router = useRouter()
const connectionStore = useConnectionStore()
const { dark, toggle: toggleDark } = useDarkMode()

// ── State ─────────────────────────────────────────────────────────────────────

// Read synchronously so EntitySearch receives preset values on first render.
const _historyExample = (history.state as Record<string, unknown>)?.example as
  | { entity1: EntitySearchResult; entity2: EntitySearchResult; options?: Partial<GraphOptions> }
  | undefined

const presetEntity1 = ref<EntitySearchResult | null>(_historyExample?.entity1 ?? null)
const presetEntity2 = ref<EntitySearchResult | null>(_historyExample?.entity2 ?? null)
const entity1 = ref<EntitySearchResult | null>(presetEntity1.value)
const entity2 = ref<EntitySearchResult | null>(presetEntity2.value)
const graph = ref<RelationshipGraph | null>(null)
const searching = ref(false)
const searchError = ref('')
const selectedNode = ref<GraphNode | null>(null)
const sidebarCollapsed = ref(false)
const optionsOpen = ref(false)

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

// ── Find relationships ────────────────────────────────────────────────────────

async function onFindRelationships() {
  if (!entity1.value || !entity2.value) return

  searching.value = true
  searchError.value = ''
  graph.value = null
  selectedNode.value = null

  try {
    const context = connectionStore.queryContext
    const store = connectionStore.rdfStore ?? undefined
    const effectiveContext = context ?? { endpointUrl: '' }

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
      searchError.value = 'No relationships found between the selected entities.'
    }
  } catch (err) {
    searchError.value =
      err instanceof Error
        ? `Query failed: ${err.message}`
        : 'An unexpected error occurred. Check the browser console for details.'
  } finally {
    searching.value = false
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

function onDisconnect() {
  connectionStore.disconnect()
  router.push({ name: 'connection' })
}

// ── Auto-run when entities are preset (from browse or examples panel) ────────

onMounted(() => {
  if (_historyExample) onFindRelationships()
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

// All other options: full re-query (debounced to absorb slider/toggle bursts).
// A computed serialises only the re-query-relevant fields so that a language-only
// change produces an identical string and never triggers this watch.
const _requerySignal = computed(() =>
  JSON.stringify({
    maxDistance: graphOptions.value.maxDistance,
    ignoredProperties: graphOptions.value.ignoredProperties,
    avoidCycles: graphOptions.value.avoidCycles,
    customLabelProperties: graphOptions.value.customLabelProperties,
  }),
)

let optionsTimer: ReturnType<typeof setTimeout> | null = null
watch(_requerySignal, () => {
  if (!entity1.value || !entity2.value) return
  if (optionsTimer) clearTimeout(optionsTimer)
  optionsTimer = setTimeout(onFindRelationships, 500)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}
</script>

<style scoped>
.graph-view {
  display: flex;
  height: 100vh;
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
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rf-primary) 70%, transparent); }
  50%       { box-shadow: 0 0 0 10px color-mix(in srgb, var(--rf-primary) 0%, transparent); }
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
</style>
