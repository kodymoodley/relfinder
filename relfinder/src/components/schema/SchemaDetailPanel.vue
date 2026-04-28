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
            <span class="conn-via">via <em>{{ item.dominantProp }}</em></span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Edge view -->
    <template v-else-if="props.selectedEdge && !props.selectedNode">
      <div class="detail-section edge-header-row">
        <Tag :value="resolveLabel(props.selectedEdge.sourceIri)" severity="secondary" class="edge-tag" />
        <i class="pi pi-arrow-right edge-arrow" />
        <Tag :value="resolveLabel(props.selectedEdge.targetIri)" severity="secondary" class="edge-tag" />
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

      <div class="detail-section">
        <Button
          label="Explore in Graph View"
          icon="pi pi-share-alt"
          size="small"
          @click="emitExplore"
        />
      </div>
    </template>
  </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Drawer from 'primevue/drawer'
import Tag from 'primevue/tag'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useConnectionStore } from '@/stores/connection'
import { useSchemaStore } from '@/stores/schema'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'

const props = defineProps<{
  selectedNode: SchemaNode | null
  selectedEdge: SchemaEdge | null
  allNodes: SchemaNode[]
  allEdges: SchemaEdge[]
}>()

const emit = defineEmits<{
  explore: [sourceIri: string, targetIri: string]
  'update:selectedNode': [value: SchemaNode | null]
  'update:selectedEdge': [value: SchemaEdge | null]
}>()

const connectionStore = useConnectionStore()
const schemaStore = useSchemaStore()

const visible = ref(false)

watch(
  () => [props.selectedNode, props.selectedEdge] as const,
  ([n, e]) => { visible.value = n !== null || e !== null },
  { immediate: true },
)

watch(visible, (v) => {
  if (!v) {
    emit('update:selectedNode', null)
    emit('update:selectedEdge', null)
  }
})

watch(
  () => props.selectedNode,
  (node) => {
    if (!node) return
    nextTick(() => {
      const context = connectionStore.queryContext ?? { endpointUrl: '' }
      const store = connectionStore.rdfStore ?? undefined
      schemaStore.fetchDataProps(node.iri, context, store).catch(() => {})
    })
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

const loadingDataProps = computed(() =>
  props.selectedNode ? schemaStore.dataPropsLoading.has(props.selectedNode.iri) : false,
)

const dataPropsStatusMsg = computed(() =>
  props.selectedNode ? (schemaStore.dataPropsStatus.get(props.selectedNode.iri) ?? 'Querying endpoint…') : '',
)

const dataProps = computed(() =>
  props.selectedNode ? (schemaStore.dataPropsCache.get(props.selectedNode.iri) ?? []) : [],
)

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

function emitExplore() {
  if (props.selectedEdge) {
    emit('explore', props.selectedEdge.sourceIri, props.selectedEdge.targetIri)
  }
}
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
</style>
