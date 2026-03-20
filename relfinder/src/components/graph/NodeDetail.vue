<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    :header="node?.label ?? 'Node details'"
    class="node-detail-drawer"
    :pt="{ root: { style: 'width: 360px' }, header: { style: 'padding-left: 1.5rem' }, content: { style: 'padding: 1.25rem 1.5rem' } }"
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

        <p v-else-if="dataProps.length === 0" class="props-empty">
          No data properties found.
        </p>

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

      dataProps.value = await fetchDataProperties(node.iri, effectiveContext, 50, store, props.language ?? 'en')
    } catch (err) {
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
  margin-bottom: 1.5rem;
}

.section-label {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.iri-link {
  font-size: 0.8rem;
  word-break: break-all;
  color: var(--p-primary-color);
  text-decoration: none;
}

.iri-link:hover {
  text-decoration: underline;
}

.props-loading {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
}

.props-empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.props-table {
  font-size: 0.82rem;
}

.prop-value {
  word-break: break-word;
}
</style>
