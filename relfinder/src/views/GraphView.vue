<template>
  <div class="graph-view">
    <!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
    <aside class="sidebar" :class="{ 'sidebar--collapsed': sidebarCollapsed }">
      <div class="sidebar-header">
        <span v-show="!sidebarCollapsed" class="app-brand">RelFinder</span>
        <div class="header-actions">
          <Button
            :icon="sidebarCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-left'"
            text
            rounded
            size="small"
            @click="sidebarCollapsed = !sidebarCollapsed"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
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
        </div>
      </div>

      <div v-show="!sidebarCollapsed" class="sidebar-body">
        <!-- Entity selection -->
        <section class="sidebar-section">
          <EntitySearch
            id="entity1"
            label="Entity 1"
            placeholder="Search…"
            dot-color="#4f8ef7"
            :allowed-classes="graphOptions.allowedClasses"
            :language="graphOptions.language"
            :custom-label-properties="graphOptions.customLabelProperties"
            @select="entity1 = $event"
          />
        </section>

        <section class="sidebar-section">
          <EntitySearch
            id="entity2"
            label="Entity 2"
            placeholder="Search…"
            dot-color="#f76b4f"
            :allowed-classes="graphOptions.allowedClasses"
            :language="graphOptions.language"
            :custom-label-properties="graphOptions.customLabelProperties"
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
            fluid
            @click="onFindRelationships"
          />
          <Message v-if="searchError" severity="error" :closable="true" @close="searchError = ''">
            {{ searchError }}
          </Message>
        </section>

        <!-- Results summary -->
        <section v-if="graph" class="sidebar-section results-summary">
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
        <section v-if="graph && graph.classes.length > 0" class="sidebar-section">
          <p class="section-label">Legend</p>
          <div class="legend">
            <div
              v-for="cls in graph.classes"
              :key="cls"
              class="legend-item"
            >
              <span
                class="legend-dot"
                :style="{ background: classColors.get(cls) ?? '#94a3b8' }"
              />
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
          <OptionsPanel v-if="optionsOpen" v-model="graphOptions" />
        </section>
      </div>
    </aside>

    <!-- ── Graph canvas ─────────────────────────────────────────────────────── -->
    <main class="graph-main">
      <GraphCanvas
        :nodes="graph?.nodes ?? []"
        :edges="graph?.edges ?? []"
        :loading="searching"
        :class-colors="classColors"
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
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useConnectionStore } from '@/stores/connection'
import { findRelationships } from '@/lib/sparql/entitySearch'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import type { EntitySearchResult, RelationshipGraph, GraphNode } from '@/lib/sparql/types'
import EntitySearch from '@/components/graph/EntitySearch.vue'
import OptionsPanel from '@/components/graph/OptionsPanel.vue'
import type { GraphOptions } from '@/components/graph/OptionsPanel.vue'
import GraphCanvas from '@/components/graph/GraphCanvas.vue'
import NodeDetail from '@/components/graph/NodeDetail.vue'

const router = useRouter()
const connectionStore = useConnectionStore()

// ── State ─────────────────────────────────────────────────────────────────────

const entity1 = ref<EntitySearchResult | null>(null)
const entity2 = ref<EntitySearchResult | null>(null)
const graph = ref<RelationshipGraph | null>(null)
const searching = ref(false)
const searchError = ref('')
const selectedNode = ref<GraphNode | null>(null)
const sidebarCollapsed = ref(false)
const optionsOpen = ref(true)

const graphOptions = ref<GraphOptions>({
  maxDistance: 2,
  ignoredProperties: [
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://www.w3.org/2004/02/skos/core#subject',
  ],
  avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES,
  allowedClasses: [],
  language: '',
  customLabelProperties: [],
})

// ── Class colour assignment ───────────────────────────────────────────────────

const PALETTE = [
  '#4f8ef7', '#f76b4f', '#4fc994', '#f7c94f',
  '#a44ff7', '#4ff7f0', '#f74fa4', '#8ef74f',
]

const classColors = ref(new Map<string, string>())

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
  background: var(--p-surface-ground);
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */

.sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--p-content-background);
  border-right: 1px solid var(--p-content-border-color);
  transition: width 0.2s ease;
  overflow: hidden;
}

.sidebar--collapsed {
  width: 48px;
}

.sidebar--collapsed .sidebar-header {
  justify-content: center;
  padding-inline: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
  min-height: 48px;
}

.app-brand {
  font-weight: 700;
  font-size: 1rem;
  color: var(--p-primary-color);
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 0.1rem;
  flex-shrink: 0;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 0;
}

.sidebar-section {
  padding: 0.625rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.section-label.collapsible {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  user-select: none;
}

.section-label.collapsible:hover {
  color: var(--p-primary-color);
}

/* ── Results summary ──────────────────────────────────────────────────────── */

.results-summary {
  flex-direction: row;
  gap: 1rem;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.summary-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

/* ── Legend ───────────────────────────────────────────────────────────────── */

.legend {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Main graph area ──────────────────────────────────────────────────────── */

.graph-main {
  flex: 1;
  position: relative;
  overflow: hidden;
}
</style>
