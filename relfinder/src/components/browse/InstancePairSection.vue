<template>
  <div class="inst-section">
    <FuzzyEntityInput
      id="inst-a"
      label="Entity A"
      dot-color="#f97316"
      @select="entity1 = $event; result = null; checkError = ''"
    />
    <FuzzyEntityInput
      id="inst-b"
      label="Entity B"
      dot-color="#8b5cf6"
      @select="entity2 = $event; result = null; checkError = ''"
    />

    <Button
      :label="checking ? 'Checking…' : 'Check Connection'"
      :icon="checking ? 'pi pi-spin pi-spinner' : 'pi pi-link'"
      size="small"
      fluid
      :disabled="!entity1 || !entity2 || checking"
      @click="checkConnection"
    />

    <!-- Result -->
    <div
      v-if="result"
      class="inst-result"
      v-motion
      :initial="{ opacity: 0, y: -8 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 250, ease: 'easeOut' } }"
    >
      <template v-if="result.found">
        <div class="result-header">
          <span class="result-badge">{{ result.hops }}-hop connection</span>
          <span class="result-desc">
            {{ entity1?.label }} → {{ entity2?.label }}
          </span>
        </div>
        <button class="explore-btn" @click="onExplore">
          <span>Explore in graph</span>
          <i class="pi pi-arrow-right" />
        </button>
      </template>

      <template v-else>
        <div class="result-empty">
          <i class="pi pi-info-circle result-empty-icon" />
          <span>No connection found within 3 hops.</span>
        </div>
      </template>
    </div>

    <!-- Error -->
    <div v-if="checkError" class="inst-error">
      <i class="pi pi-exclamation-triangle" />
      <span>{{ checkError }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import FuzzyEntityInput from './FuzzyEntityInput.vue'
import { useConnectionStore } from '@/stores/connection'
import { findRelationships } from '@/lib/sparql/entitySearch'
import { cacheSet } from '@/lib/cache/queryCache'
import type { EntitySearchResult, RelationshipGraph } from '@/lib/sparql/types'
import { QueryCyclesStrategy } from '@/lib/sparql/types'

const router = useRouter()
const connectionStore = useConnectionStore()

const entity1 = ref<EntitySearchResult | null>(null)
const entity2 = ref<EntitySearchResult | null>(null)
const checking = ref(false)
const checkError = ref('')
const result = ref<
  { found: false } | { found: true; hops: number; graph: RelationshipGraph; key: string } | null
>(null)

async function checkConnection() {
  if (!entity1.value || !entity2.value) return
  checking.value = true
  checkError.value = ''
  result.value = null

  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  const effectiveCtx = ctx ?? { endpointUrl: '' }
  const opts = { avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES, store }
  const baseKey = `graph:${effectiveCtx.endpointUrl}:${entity1.value.iri}:${entity2.value.iri}`

  try {
    const g2 = await findRelationships(entity1.value.iri, entity2.value.iri, 2, effectiveCtx, opts)
    if (g2.nodes.length > 0) {
      cacheSet(baseKey, g2, 30 * 60 * 1000)
      result.value = { found: true, hops: 2, graph: g2, key: baseKey }
      return
    }

    const g3 = await findRelationships(entity1.value.iri, entity2.value.iri, 3, effectiveCtx, opts)
    if (g3.nodes.length > 0) {
      cacheSet(baseKey, g3, 30 * 60 * 1000)
      result.value = { found: true, hops: 3, graph: g3, key: baseKey }
    } else {
      result.value = { found: false }
    }
  } catch (err) {
    checkError.value = err instanceof Error ? `Query failed: ${err.message}` : 'An unexpected error occurred.'
  } finally {
    checking.value = false
  }
}

function onExplore() {
  if (!result.value?.found || !entity1.value || !entity2.value) return
  router.push({
    name: 'graph',
    state: {
      example: JSON.parse(
        JSON.stringify({
          entity1: entity1.value,
          entity2: entity2.value,
          cacheKey: result.value.key,
        }),
      ),
    },
  })
}
</script>

<style scoped>
.inst-section {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-4);
  padding: var(--rf-space-4);
}

/* ── Result ───────────────────────────────────────────────────────────────── */

.inst-result {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-3);
  padding: var(--rf-space-3) var(--rf-space-4);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
}

.result-header {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.result-badge {
  display: inline-flex;
  align-self: flex-start;
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-primary);
  background: var(--rf-primary-soft);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 25%, transparent);
  border-radius: var(--rf-radius-full);
  padding: 0.1rem 0.55rem;
}

.result-desc {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-empty {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
}

.result-empty-icon {
  font-size: var(--rf-text-sm);
  flex-shrink: 0;
}

/* ── Explore button ───────────────────────────────────────────────────────── */

.explore-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-primary-soft);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 30%, transparent);
  border-radius: var(--rf-radius-sm);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-primary);
  cursor: pointer;
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.explore-btn:hover {
  background: color-mix(in srgb, var(--rf-primary) 18%, transparent);
  border-color: color-mix(in srgb, var(--rf-primary) 50%, transparent);
}

/* ── Error ────────────────────────────────────────────────────────────────── */

.inst-error {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  border-radius: var(--rf-radius-md);
  font-size: var(--rf-text-xs);
  color: var(--rf-danger);
  background: var(--rf-danger-soft);
  border: 1px solid color-mix(in srgb, var(--rf-danger) 25%, transparent);
}
</style>
