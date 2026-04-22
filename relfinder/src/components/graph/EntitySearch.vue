<template>
  <div class="entity-search">
    <div class="field">
      <label :for="`entity-${id}-input`">{{ label }}</label>

      <!--
        AutoComplete is only mounted while no entity is selected.
        Destroying it on selection prevents PrimeVue from firing a second
        @complete (with the selected label as query) that would trigger
        force-selection to clear the value when the new suggestion list
        doesn't contain an exact match.
      -->
      <AutoComplete
        v-if="!selectedEntity"
        :inputId="`entity-${id}-input`"
        v-model="inputText"
        :suggestions="suggestions"
        option-label="label"
        :placeholder="placeholder"
        :loading="searching"
        force-selection
        fluid
        @complete="onSearch"
        @item-select="onSelect"
      >
        <template #option="{ option }">
          <div class="suggestion-item">
            <span class="suggestion-label">{{ option.label }}</span>
            <Tag :value="shortClass(option.class)" severity="secondary" class="suggestion-tag" />
          </div>
        </template>
        <template #empty>
          <span class="no-results">No entities found</span>
        </template>
      </AutoComplete>

      <!-- Chip replaces the input once an entity is selected -->
      <div v-else class="selected-chip">
        <i class="pi pi-circle-fill chip-dot" :style="{ color: dotColor }" />
        <span class="chip-label" :title="selectedEntity.iri">{{ selectedEntity.label }}</span>
        <button class="chip-remove" @click="onClear" aria-label="Remove">
          <i class="pi pi-times" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AutoComplete from 'primevue/autocomplete'
import Tag from 'primevue/tag'
import { useConnectionStore } from '@/stores/connection'
import { searchEntities } from '@/lib/sparql/entitySearch'
import type { EntitySearchResult } from '@/lib/sparql/types'

const props = defineProps<{
  id: string
  label: string
  placeholder?: string
  /** CSS colour used for the dot indicator — lets the parent colour-code entities */
  dotColor?: string
  /** RDF class IRIs to restrict search to. Empty = all classes. */
  allowedClasses?: string[]
  /** RDF language tag for label matching (e.g. 'en'). Empty = any language. */
  language?: string
  /** Extra predicate IRIs to recognise as labels in addition to the built-in set. */
  customLabelProperties?: string[]
}>()

const emit = defineEmits<{
  select: [entity: EntitySearchResult | null]
}>()

const connectionStore = useConnectionStore()

// Separate refs: inputText drives the AutoComplete input; selectedEntity drives
// the chip. Using v-if on the AutoComplete means these never conflict.
const inputText = ref<string | EntitySearchResult>('')
const selectedEntity = ref<EntitySearchResult | null>(null)
const suggestions = ref<EntitySearchResult[]>([])
const searching = ref(false)

// ── Search ────────────────────────────────────────────────────────────────────

async function onSearch(event: { query: string }) {
  const query = event.query.trim()
  searching.value = true

  try {
    const context = connectionStore.queryContext
    const store = connectionStore.rdfStore ?? undefined
    const effectiveContext = context ?? { endpointUrl: '' }

    suggestions.value = await searchEntities(
      effectiveContext,
      props.allowedClasses ?? [],
      store,
      50,
      query,
      props.language ?? 'en',
      props.customLabelProperties ?? [],
    )
  } catch {
    suggestions.value = []
  } finally {
    searching.value = false
  }
}

function onSelect(event: { value: EntitySearchResult }) {
  selectedEntity.value = event.value
  emit('select', event.value)
}

function onClear() {
  selectedEntity.value = null
  suggestions.value = []
  inputText.value = ''
  emit('select', null)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortClass(classIri: string): string {
  return classIri.split('/').pop()?.split('#').pop() ?? classIri
}
</script>

<style scoped>
.entity-search {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.field label {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.suggestion-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-2);
  width: 100%;
}

.suggestion-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--rf-text-sm);
}

.suggestion-tag {
  flex-shrink: 0;
  font-size: var(--rf-text-xs);
}

.no-results {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  padding: var(--rf-space-1) 0;
}

.selected-chip {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  font-size: var(--rf-text-sm);
  min-height: 2.25rem;
  transition: border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.selected-chip:hover {
  border-color: var(--rf-border-strong);
}

.chip-dot {
  font-size: 0.6rem;
  flex-shrink: 0;
}

.chip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
}

.chip-remove {
  background: none;
  border: none;
  padding: var(--rf-space-1);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: var(--rf-radius-full);
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.chip-remove:hover {
  color: var(--rf-danger);
  background: var(--rf-danger-soft);
}
</style>
