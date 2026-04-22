<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    :header="node?.label ?? 'Node details'"
    class="node-detail-drawer"
    :pt="{ root: { style: 'width: 380px' } }"
  >
    <template v-if="node">
      <!-- IRI -->
      <div class="detail-section">
        <p class="section-label">IRI</p>
        <a :href="node.iri" target="_blank" rel="noopener" class="iri-link">
          {{ node.iri }}
          <i class="pi pi-external-link" style="font-size: 0.7rem; margin-left: 0.25rem" />
        </a>
      </div>

      <!-- Type -->
      <div class="detail-section">
        <p class="section-label">Type</p>
        <Tag :value="shortIri(node.class)" severity="secondary" />
      </div>

      <!-- Data properties -->
      <div class="detail-section">
        <p class="section-label">Properties</p>

        <div v-if="loadingProps" class="props-loading">
          <ProgressSpinner stroke-width="4" style="width: 28px; height: 28px" />
        </div>

        <Message v-else-if="propsError" severity="warn" :closable="false">
          {{ propsError }}
        </Message>

        <p v-else-if="dataProps.length === 0" class="props-empty">No data properties found.</p>

        <DataTable
          v-else
          :value="dataProps"
          size="small"
          :paginator="dataProps.length > 10"
          :rows="10"
          class="props-table"
        >
          <Column field="label" header="Property" style="width: 40%" />
          <Column field="value" header="Value">
            <template #body="{ data }">
              <span class="prop-value">{{ data.value }}</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </Drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Drawer from 'primevue/drawer'
import Tag from 'primevue/tag'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { fetchDataProperties } from '@/lib/sparql/entitySearch'
import type { GraphNode, DataProperty } from '@/lib/sparql/types'

const props = defineProps<{ node: GraphNode | null; language?: string }>()
const emit = defineEmits<{ 'update:node': [value: GraphNode | null] }>()

const connectionStore = useConnectionStore()

const visible = ref(false)
const dataProps = ref<DataProperty[]>([])
const loadingProps = ref(false)
const propsError = ref('')

// Open/close drawer when node prop changes
watch(
  () => props.node,
  async (node) => {
    if (!node) {
      visible.value = false
      return
    }

    visible.value = true
    dataProps.value = []
    propsError.value = ''
    loadingProps.value = true

    try {
      const context = connectionStore.queryContext
      const store = connectionStore.rdfStore ?? undefined
      const effectiveContext = context ?? { endpointUrl: '' }

      dataProps.value = await fetchDataProperties(
        node.iri,
        effectiveContext,
        50,
        store,
        props.language ?? 'en',
      )
    } catch {
      propsError.value = 'Could not load properties for this node.'
    } finally {
      loadingProps.value = false
    }
  },
)

// When the drawer is closed by the user, clear the selected node
watch(visible, (v) => {
  if (!v) emit('update:node', null)
})

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
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

.props-loading {
  display: flex;
  justify-content: center;
  padding: var(--rf-space-4) 0;
}

.props-empty {
  margin: 0;
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  font-style: italic;
}

.props-table {
  font-size: var(--rf-text-xs);
}

.prop-value {
  word-break: break-word;
  color: var(--rf-text);
}
</style>
