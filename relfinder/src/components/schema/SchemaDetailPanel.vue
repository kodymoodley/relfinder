<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    :header="panelHeader"
    class="schema-detail-drawer"
    :pt="{ root: { style: 'width: 380px' } }"
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

      <div class="detail-section">
        <p class="section-label">Outgoing connections</p>
        <p v-if="outgoing.length === 0" class="list-empty">No outgoing connections.</p>
        <ul v-else class="connection-list">
          <li v-for="item in outgoing" :key="item.targetIri" class="connection-item">
            <span class="conn-label">{{ item.targetLabel }}</span>
            <span class="conn-via">via <em>{{ item.dominantProp }}</em></span>
          </li>
        </ul>
      </div>

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
import { ref, computed, watch } from 'vue'
import Drawer from 'primevue/drawer'
import Tag from 'primevue/tag'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
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

const visible = ref(false)

watch(
  () => [props.selectedNode, props.selectedEdge],
  ([n, e]) => { visible.value = n !== null || e !== null },
  { immediate: true },
)

watch(visible, (v) => {
  if (!v) {
    emit('update:selectedNode', null)
    emit('update:selectedEdge', null)
  }
})

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

const outgoing = computed(() => {
  if (!props.selectedNode) return []
  return props.allEdges
    .filter((e) => e.sourceIri === props.selectedNode!.iri)
    .map((e) => ({
      targetIri: e.targetIri,
      targetLabel: resolveLabel(e.targetIri),
      dominantProp: e.props[0]?.label ?? '',
    }))
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
