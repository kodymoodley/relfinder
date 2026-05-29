<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    :header="panelHeader"
    class="schema-detail-drawer"
    :pt="{ root: { style: 'width: 400px' } }"
  >
    <!-- Node view -->
    <template v-if="props.selectedNode && !props.selectedEdge">
      <div class="detail-section">
        <p class="section-label">IRI</p>
        <a :href="props.selectedNode.iri" target="_blank" rel="noopener" class="iri-link">
          {{ props.selectedNode.iri }}
          <i class="pi pi-external-link" style="font-size: 0.7rem; margin-left: 0.25rem" />
        </a>
      </div>

      <!-- Description -->
      <div class="detail-section">
        <div v-if="loadingDescription" class="spinner-row">
          <ProgressSpinner stroke-width="4" style="width: 20px; height: 20px" />
          <span class="spinner-status">{{ descriptionStatusMsg }}</span>
        </div>
        <p v-else-if="description" class="description-text">{{ description }}</p>
      </div>

      <!-- Instances (sample) -->
      <div class="detail-section">
        <p class="section-label">Instances <span class="section-label-hint">(sample)</span></p>
        <div v-if="loadingInstances" class="spinner-row">
          <ProgressSpinner stroke-width="4" style="width: 20px; height: 20px" />
          <span class="spinner-status">Loading…</span>
        </div>
        <p v-else-if="instances.length === 0" class="list-empty">No instances found.</p>
        <template v-else>
          <!-- Search filter -->
          <div class="instance-search-wrap">
            <i class="pi pi-search instance-search-icon" />
            <input
              ref="instanceSearchRef"
              v-model="instanceSearch"
              class="instance-search-input"
              placeholder="Filter instances…"
              autocomplete="off"
            />
            <Transition name="source-badge">
              <span
                v-if="searchMode"
                :key="searchMode"
                class="search-source-badge"
                :class="`search-source-badge--${searchMode}`"
                :title="
                  searchMode === 'live'
                    ? 'Results from SPARQL endpoint'
                    : searchMode === 'querying'
                      ? 'Querying endpoint…'
                      : 'Results from local cache'
                "
              >
                <span class="search-source-dot" />
                <span v-if="searchMode === 'live'" class="search-source-text">endpoint</span>
              </span>
            </Transition>
            <button
              v-if="instanceSearch"
              class="instance-search-clear"
              aria-label="Clear filter"
              @click="clearInstanceSearch"
            >
              <i class="pi pi-times" />
            </button>
          </div>
          <p v-if="!instanceSearchLoading && displayedInstances.length === 0" class="list-empty">
            No matches.
          </p>

          <!-- Start entity chip — shared with CommandPalette via pathStartEntity -->
          <div v-if="pathStartEntity" class="start-chip">
            <span class="start-dot" />
            <span class="start-chip-label" :title="pathStartEntity.iri">{{
              pathStartEntity.label
            }}</span>
            <button
              class="start-chip-clear"
              aria-label="Clear start"
              @click="pathStartEntity = null"
            >
              <i class="pi pi-times" />
            </button>
          </div>
          <p v-if="pathStartEntity" class="start-hint">Pick a destination:</p>
          <ul class="instance-list">
            <li
              v-for="inst in displayedInstances"
              :key="inst.iri"
              class="instance-item"
              :class="{
                'instance-item--start': pathStartEntity?.iri === inst.iri,
                'instance-item--expanded': expandedInstances.has(inst.iri),
              }"
            >
              <div class="instance-row">
                <button
                  class="info-btn"
                  :aria-label="expandedInstances.has(inst.iri) ? 'Hide details' : 'Show details'"
                  @click.stop="toggleExpand(inst.iri)"
                >
                  <i
                    :class="[
                      'pi',
                      expandedInstances.has(inst.iri) ? 'pi-chevron-down' : 'pi-info-circle',
                    ]"
                  />
                </button>
                <span class="instance-label" :title="inst.iri">{{ inst.label }}</span>
                <Button
                  v-if="!pathStartEntity"
                  size="small"
                  text
                  label="Set as start"
                  class="set-start-btn"
                  @click="
                    pathStartEntity = {
                      iri: inst.iri,
                      label: inst.label,
                      class: props.selectedNode!.iri,
                    }
                  "
                />
                <Button
                  v-else-if="pathStartEntity.iri !== inst.iri"
                  size="small"
                  text
                  label="Find path →"
                  class="find-path-btn"
                  @click="doFindPath(inst)"
                />
              </div>
              <div v-if="expandedInstances.has(inst.iri)" class="instance-detail">
                <a :href="inst.iri" target="_blank" rel="noopener" class="instance-iri">
                  {{ inst.iri
                  }}<i
                    class="pi pi-external-link"
                    style="font-size: 0.65rem; margin-left: 0.25rem"
                  />
                </a>
                <div v-if="schemaStore.entityPropsLoading.has(inst.iri)" class="spinner-row">
                  <ProgressSpinner stroke-width="4" style="width: 16px; height: 16px" />
                  <span class="spinner-status">Loading…</span>
                </div>
                <template v-else>
                  <p v-if="entityProps(inst.iri).length === 0" class="list-empty">
                    No data properties found.
                  </p>
                  <table v-else class="entity-props-table">
                    <tr
                      v-for="p in entityProps(inst.iri)"
                      :key="p.predIri + p.value"
                      class="entity-prop-row"
                    >
                      <td class="entity-prop-pred" :title="p.predIri">{{ p.predLabel }}</td>
                      <td class="entity-prop-val">{{ p.value }}</td>
                    </tr>
                  </table>
                </template>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <!-- Data properties -->
      <div class="detail-section">
        <p class="section-label">Data Properties</p>
        <div v-if="loadingDataProps" class="spinner-row">
          <ProgressSpinner stroke-width="4" style="width: 20px; height: 20px" />
          <span class="spinner-status">{{ dataPropsStatusMsg }}</span>
        </div>
        <p v-else-if="dataProps.length === 0" class="list-empty">No data properties found.</p>
        <ul v-else class="prop-list">
          <li v-for="dp in dataProps" :key="dp.iri" class="prop-item">
            <span class="prop-name">{{ dp.label }}</span>
            <span v-if="dp.datatypes.length" class="prop-types">
              <code v-for="dt in dp.datatypes" :key="dt" class="type-chip">{{ dt }}</code>
            </span>
          </li>
        </ul>
      </div>

      <!-- Object properties -->
      <div class="detail-section">
        <p class="section-label">Object Properties</p>
        <p v-if="objectProps.length === 0" class="list-empty">No object properties found.</p>
        <ul v-else class="prop-list">
          <li v-for="op in objectProps" :key="op.propIri + op.rangeIri" class="prop-item">
            <span class="prop-name">{{ op.propLabel }}</span>
            <span class="prop-range">
              <i class="pi pi-arrow-right range-arrow" />
              {{ op.rangeLabel }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Incoming connections -->
      <div class="detail-section">
        <p class="section-label">Incoming connections</p>
        <p v-if="incoming.length === 0" class="list-empty">No incoming connections.</p>
        <ul v-else class="connection-list">
          <li v-for="item in incoming" :key="item.sourceIri" class="connection-item">
            <span class="conn-label">{{ item.sourceLabel }}</span>
            <span class="conn-via"
              >via <em>{{ item.dominantProp }}</em></span
            >
          </li>
        </ul>
      </div>
    </template>

    <!-- Edge view -->
    <template v-else-if="props.selectedEdge && !props.selectedNode">
      <div class="detail-section edge-header-row">
        <Tag
          :value="resolveLabel(props.selectedEdge.sourceIri)"
          severity="secondary"
          class="edge-tag"
        />
        <i class="pi pi-arrow-right edge-arrow" />
        <Tag
          :value="resolveLabel(props.selectedEdge.targetIri)"
          severity="secondary"
          class="edge-tag"
        />
      </div>

      <div class="detail-section">
        <p class="section-label">Properties ({{ props.selectedEdge.props.length }})</p>
        <DataTable :value="props.selectedEdge.props" size="small" class="props-table">
          <Column field="label" header="Property" style="width: 60%" />
          <Column field="count" header="Count" style="width: 40%; text-align: right">
            <template #body="{ data }">
              <span class="count-badge">{{ data.count.toLocaleString() }}</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useNavigationStore } from '@/stores/navigation'
import Drawer from 'primevue/drawer'
import Tag from 'primevue/tag'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useConnectionStore } from '@/stores/connection'
import { useSchemaStore } from '@/stores/schema'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'
import { recordView, recordDwell } from '@/lib/search/interestModel'
import { searchEntities } from '@/lib/sparql/entitySearch'

const { pathStartEntity } = storeToRefs(useNavigationStore())

const props = defineProps<{
  selectedNode: SchemaNode | null
  selectedEdge: SchemaEdge | null
  allNodes: SchemaNode[]
  allEdges: SchemaEdge[]
}>()

const emit = defineEmits<{
  'update:selectedNode': [value: SchemaNode | null]
  'update:selectedEdge': [value: SchemaEdge | null]
  'find-paths': [
    start: { iri: string; label: string; class: string },
    end: { iri: string; label: string; class: string },
  ]
}>()

const expandedInstances = ref<Set<string>>(new Set())
const instanceSearch = ref('')
const instanceSearchRef = ref<HTMLInputElement | null>(null)
const instanceSearchResults = ref<Array<{ iri: string; label: string }>>([])
const instanceSearchLoading = ref(false)
let _searchSeq = 0
let _instanceSearchTimer: ReturnType<typeof setTimeout> | null = null

function doFindPath(inst: { iri: string; label: string }) {
  const start = pathStartEntity.value!
  pathStartEntity.value = null
  emit('find-paths', start, { iri: inst.iri, label: inst.label, class: props.selectedNode!.iri })
}

function clearInstanceSearch() {
  instanceSearch.value = ''
  nextTick(() => instanceSearchRef.value?.focus())
}

async function runInstanceSparqlSearch(query: string, classIri: string) {
  const seq = ++_searchSeq
  instanceSearchLoading.value = true
  instanceSearchResults.value = []
  const client = connectionStore.sparqlClient
  if (!client) return
  try {
    const results = await searchEntities(client, {
      allowedClasses: [classIri],
      limit: 20,
      textFilter: query,
    })
    if (seq !== _searchSeq) return
    const mapped = results.map((r) => ({ iri: r.iri, label: r.label }))
    instanceSearchResults.value = mapped
    schemaStore.mergeInstances(classIri, mapped)
  } catch {
    if (seq === _searchSeq) instanceSearchResults.value = []
  } finally {
    if (seq === _searchSeq) instanceSearchLoading.value = false
  }
}

// ── Dwell tracking ────────────────────────────────────────────────────────────

let _dwellIri: string | null = null
let _dwellStart: number | null = null

function commitDwell() {
  if (_dwellIri !== null && _dwellStart !== null) {
    recordDwell(_dwellIri, Date.now() - _dwellStart)
    _dwellIri = null
    _dwellStart = null
  }
}

onUnmounted(commitDwell)

function toggleExpand(iri: string) {
  const next = new Set(expandedInstances.value)
  if (next.has(iri)) {
    next.delete(iri)
  } else {
    next.add(iri)
    const client = connectionStore.sparqlClient
    if (client) schemaStore.fetchEntityPropsForInstance(iri, client).catch(() => {})
  }
  expandedInstances.value = next
}

function entityProps(iri: string) {
  return schemaStore.entityPropsCache.get(iri) ?? []
}

const connectionStore = useConnectionStore()
const schemaStore = useSchemaStore()

const visible = ref(false)

watch(
  () => [props.selectedNode, props.selectedEdge] as const,
  ([n, e]) => {
    visible.value = n !== null || e !== null
  },
  { immediate: true },
)

watch(visible, (v) => {
  if (!v) {
    commitDwell()
    emit('update:selectedNode', null)
    emit('update:selectedEdge', null)
  }
})

watch(
  () => props.selectedNode,
  (node, prev) => {
    if (prev) commitDwell()
    instanceSearch.value = ''
    instanceSearchResults.value = []
    instanceSearchLoading.value = false
    ++_searchSeq
    if (!node) return
    const client = connectionStore.sparqlClient
    if (client) {
      schemaStore.fetchDataProps(node.iri, client).catch(() => {})
      schemaStore.fetchDescription(node.iri, client).catch(() => {})
      schemaStore.fetchInstances(node.iri, client).catch(() => {})
    }
    recordView(node.iri)
    _dwellIri = node.iri
    _dwellStart = Date.now()
  },
)

// ── Derived display data ──────────────────────────────────────────────────────

const labelMap = computed(() => {
  const m = new Map<string, string>()
  for (const n of props.allNodes) m.set(n.iri, n.label)
  return m
})

function resolveLabel(iri: string): string {
  return labelMap.value.get(iri) ?? iri.split(/[/#]/).pop() ?? iri
}

const panelHeader = computed(() => {
  if (props.selectedNode) return props.selectedNode.label
  if (props.selectedEdge) {
    return `${resolveLabel(props.selectedEdge.sourceIri)} → ${resolveLabel(props.selectedEdge.targetIri)}`
  }
  return 'Details'
})

const loadingDescription = computed(() =>
  props.selectedNode ? schemaStore.descriptionLoading.has(props.selectedNode.iri) : false,
)

const descriptionStatusMsg = computed(() =>
  props.selectedNode
    ? (schemaStore.descriptionStatus.get(props.selectedNode.iri) ?? 'Fetching description…')
    : '',
)

const description = computed(() =>
  props.selectedNode ? (schemaStore.descriptionCache.get(props.selectedNode.iri) ?? '') : '',
)

const loadingDataProps = computed(() =>
  props.selectedNode ? schemaStore.dataPropsLoading.has(props.selectedNode.iri) : false,
)

const dataPropsStatusMsg = computed(() =>
  props.selectedNode
    ? (schemaStore.dataPropsStatus.get(props.selectedNode.iri) ?? 'Querying endpoint…')
    : '',
)

const dataProps = computed(() =>
  props.selectedNode ? (schemaStore.dataPropsCache.get(props.selectedNode.iri) ?? []) : [],
)

const loadingInstances = computed(() =>
  props.selectedNode ? schemaStore.instancesLoading.has(props.selectedNode.iri) : false,
)

const instances = computed(() =>
  props.selectedNode ? (schemaStore.instancesCache.get(props.selectedNode.iri) ?? []) : [],
)

const filteredInstances = computed(() => {
  const q = instanceSearch.value.trim().toLowerCase()
  if (!q) return instances.value.slice(0, 20)
  return instances.value.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 20)
})

// When the local filter is empty and the search query is non-empty, show SPARQL results.
const displayedInstances = computed(() =>
  filteredInstances.value.length > 0 ? filteredInstances.value : instanceSearchResults.value,
)

const searchMode = computed<null | 'cached' | 'querying' | 'live'>(() => {
  if (!instanceSearch.value.trim()) return null
  if (instanceSearchLoading.value) return 'querying'
  if (instanceSearchResults.value.length > 0) return 'live'
  if (filteredInstances.value.length > 0) return 'cached'
  return null
})

watch(instanceSearch, (q) => {
  if (_instanceSearchTimer) clearTimeout(_instanceSearchTimer)
  instanceSearchResults.value = []
  ++_searchSeq
  if (!q.trim()) {
    instanceSearchLoading.value = false
    return
  }
  _instanceSearchTimer = setTimeout(() => {
    if (filteredInstances.value.length === 0 && props.selectedNode) {
      runInstanceSparqlSearch(q.trim(), props.selectedNode.iri)
    }
  }, 350)
})

const objectProps = computed(() => {
  if (!props.selectedNode) return []
  return props.allEdges
    .filter((e) => e.sourceIri === props.selectedNode!.iri)
    .flatMap((e) =>
      e.props.map((p) => ({
        propIri: p.iri,
        propLabel: p.label,
        rangeIri: e.targetIri,
        rangeLabel: resolveLabel(e.targetIri),
      })),
    )
})

const incoming = computed(() => {
  if (!props.selectedNode) return []
  return props.allEdges
    .filter((e) => e.targetIri === props.selectedNode!.iri)
    .map((e) => ({
      sourceIri: e.sourceIri,
      sourceLabel: resolveLabel(e.sourceIri),
      dominantProp: e.props[0]?.label ?? '',
    }))
})
</script>

<style scoped>
.detail-section {
  margin-bottom: var(--rf-space-6);
}

.section-label {
  margin: 0 0 var(--rf-space-2);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.iri-link {
  font-size: var(--rf-text-xs);
  word-break: break-all;
  color: var(--rf-primary);
  text-decoration: none;
  line-height: var(--rf-leading-relaxed);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.iri-link:hover {
  color: var(--rf-primary-hover);
  text-decoration: underline;
}

.spinner-row {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) 0;
}

.spinner-status {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  font-style: italic;
}

.prop-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.prop-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--rf-space-3);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-surface-alt);
  border-radius: var(--rf-radius-md);
  border: 1px solid var(--rf-border);
}

.prop-name {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-types {
  display: flex;
  gap: var(--rf-space-1);
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.type-chip {
  font-size: 10px;
  font-family: var(--rf-font-mono, monospace);
  padding: 1px 5px;
  border-radius: var(--rf-radius-sm);
  background: var(--rf-primary-soft);
  color: var(--rf-primary);
  white-space: nowrap;
}

.prop-range {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  flex-shrink: 0;
}

.range-arrow {
  font-size: 0.6rem;
  opacity: 0.6;
}

.connection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.connection-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-surface-alt);
  border-radius: var(--rf-radius-md);
  border: 1px solid var(--rf-border);
}

.conn-label {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
}

.conn-via {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
}

.conn-via em {
  font-style: italic;
  color: var(--rf-text-subtle);
}

.description-text {
  margin: 0;
  font-size: var(--rf-text-sm);
  color: var(--rf-text);
  line-height: var(--rf-leading-relaxed);
}

.list-empty {
  margin: 0;
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  font-style: italic;
}

.edge-header-row {
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  flex-wrap: wrap;
}

.edge-tag {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edge-arrow {
  color: var(--rf-text-muted);
  font-size: 0.85rem;
  flex-shrink: 0;
}

.props-table {
  font-size: var(--rf-text-xs);
}

.count-badge {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  font-variant-numeric: tabular-nums;
}

.section-label-hint {
  font-weight: var(--rf-weight-normal);
  text-transform: none;
  letter-spacing: 0;
  color: var(--rf-text-muted);
}

.instance-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.instance-item {
  display: flex;
  flex-direction: column;
  background: var(--rf-surface-alt);
  border-radius: var(--rf-radius-md);
  border: 1px solid var(--rf-border);
  overflow: hidden;
}

.instance-row {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-1) var(--rf-space-2) var(--rf-space-1) var(--rf-space-2);
}

.instance-label {
  font-size: var(--rf-text-sm);
  color: var(--rf-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.info-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--rf-text-muted);
  border-radius: var(--rf-radius-sm);
  padding: 0;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.info-btn:hover {
  color: var(--rf-primary);
}

.info-btn .pi {
  font-size: 0.7rem;
}

.instance-detail {
  padding: var(--rf-space-2) var(--rf-space-3);
  border-top: 1px solid var(--rf-border);
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.instance-iri {
  font-size: 10px;
  color: var(--rf-primary);
  text-decoration: none;
  word-break: break-all;
  line-height: 1.4;
}

.instance-iri:hover {
  text-decoration: underline;
}

.entity-props-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rf-text-xs);
}

.entity-prop-row + .entity-prop-row td {
  border-top: 1px solid var(--rf-border);
}

.entity-prop-pred {
  color: var(--rf-text-muted);
  font-weight: var(--rf-weight-medium);
  white-space: nowrap;
  padding: 2px var(--rf-space-2) 2px 0;
  vertical-align: top;
  width: 35%;
}

.entity-prop-val {
  color: var(--rf-text);
  padding: 2px 0;
  vertical-align: top;
  word-break: break-word;
}

.instance-item--start {
  border-color: color-mix(in srgb, var(--rf-primary) 40%, transparent);
  background: color-mix(in srgb, var(--rf-primary) 6%, var(--rf-surface-alt));
}

.set-start-btn {
  font-size: 11px;
  flex-shrink: 0;
  white-space: nowrap;
}

.find-path-btn {
  font-size: 11px;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--rf-primary);
}

.start-chip {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: color-mix(in srgb, var(--rf-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 35%, transparent);
  border-radius: var(--rf-radius-md);
  margin-bottom: var(--rf-space-2);
}

.start-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rf-primary);
  flex-shrink: 0;
}

.start-chip-label {
  flex: 1;
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.start-chip-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--rf-primary);
  opacity: 0.6;
  padding: 2px;
  border-radius: var(--rf-radius-sm);
  line-height: 1;
  flex-shrink: 0;
  transition: opacity var(--rf-duration-fast) var(--rf-ease-out);
}

.start-chip-clear:hover {
  opacity: 1;
}

.start-chip-clear .pi {
  font-size: 0.65rem;
}

.start-hint {
  margin: 0 0 var(--rf-space-2);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  font-style: italic;
}

.instance-search-wrap {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-1) var(--rf-space-3);
  background: var(--rf-surface-alt);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  margin-bottom: var(--rf-space-2);
  transition: border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.instance-search-wrap:focus-within {
  border-color: var(--rf-primary);
}

.instance-search-icon {
  color: var(--rf-text-subtle);
  font-size: 0.7rem;
  flex-shrink: 0;
}

.instance-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--rf-text-xs);
  color: var(--rf-text);
  caret-color: var(--rf-primary);
}

.instance-search-input::placeholder {
  color: var(--rf-text-subtle);
}

.instance-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--rf-text-subtle);
  padding: 2px;
  border-radius: var(--rf-radius-sm);
  line-height: 1;
  flex-shrink: 0;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.instance-search-clear:hover {
  color: var(--rf-text);
}

.instance-search-clear .pi {
  font-size: 0.6rem;
}

/* ── Search source badge ─────────────────────────────────────────────────── */

.search-source-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  margin-right: 2px;
}

.search-source-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.search-source-text {
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  font-weight: 600;
  line-height: 1;
}

.search-source-badge--cached .search-source-dot {
  background: var(--rf-text-subtle);
  opacity: 0.5;
}

.search-source-badge--querying .search-source-dot {
  background: var(--rf-primary);
  animation: source-pulse 1.1s ease-in-out infinite;
}

.search-source-badge--live .search-source-dot {
  background: #22c55e;
}

.search-source-badge--live .search-source-text {
  color: #22c55e;
  opacity: 0.8;
}

@keyframes source-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.25;
    transform: scale(0.65);
  }
}

.source-badge-enter-active,
.source-badge-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.source-badge-enter-from,
.source-badge-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
</style>
