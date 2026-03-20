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
            <Tag
              :value="shortClass(option.class)"
              severity="secondary"
              class="suggestion-tag"
            />
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
  gap: 0.5rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.suggestion-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
}

.suggestion-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.suggestion-tag {
  flex-shrink: 0;
  font-size: 0.7rem;
}

.no-results {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  padding: 0.25rem 0;
}

.selected-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  background: var(--p-surface-100);
  border: 1px solid var(--p-content-border-color);
  border-radius: 20px;
  font-size: 0.8rem;
  min-height: 2.25rem;
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
}

.chip-remove {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--p-text-muted-color);
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.chip-remove:hover {
  color: var(--p-red-500);
}
</style>
