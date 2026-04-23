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
      <div v-if="!selectedEntity" :class="['autocomplete-wrap', { 'autocomplete-wrap--searching': searching }]">
        <AutoComplete
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
              <Tag :value="shortIri(option.class)" severity="secondary" class="suggestion-tag" />
            </div>
          </template>
          <template #empty>
            <span class="no-results">No entities found</span>
          </template>
        </AutoComplete>
      </div>

      <Transition name="status-fade">
        <p v-if="!selectedEntity && (searching || statusMessage)" class="search-status">
          <template v-if="searching">
            <i class="pi pi-spin pi-spinner search-status-icon" />
            Searching for "{{ currentQuery }}"…
          </template>
          <template v-else-if="statusMessage">
            {{ statusMessage }}
          </template>
        </p>
      </Transition>

      <!-- Chip replaces the input once an entity is selected -->
      <div v-if="selectedEntity" class="selected-chip" :class="{ 'selected-chip--locked': !!initialEntity }">
        <i class="pi pi-circle-fill chip-dot" :style="{ color: dotColor }" />
        <span class="chip-label" :title="selectedEntity.iri">{{ selectedEntity.label }}</span>
        <button v-if="!initialEntity" class="chip-remove" @click="onClear" aria-label="Remove">
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
import { shortIri } from '@/lib/utils/iri'

const props = defineProps<{
  id: string
  label: string
  placeholder?: string
  dotColor?: string
  allowedClasses?: string[]
  language?: string
  customLabelProperties?: string[]
  /** Pre-fills the selection; when set the field is shown in a locked/disabled state. */
  initialEntity?: EntitySearchResult | null
}>()

const emit = defineEmits<{
  select: [entity: EntitySearchResult | null]
}>()

const connectionStore = useConnectionStore()

// Separate refs: inputText drives the AutoComplete input; selectedEntity drives
// the chip. Using v-if on the AutoComplete means these never conflict.
const inputText = ref<string | EntitySearchResult>('')
const selectedEntity = ref<EntitySearchResult | null>(props.initialEntity ?? null)
const suggestions = ref<EntitySearchResult[]>([])
const searching = ref(false)
const currentQuery = ref('')
const statusMessage = ref('')
let statusClearTimer: ReturnType<typeof setTimeout> | null = null

// ── Search ────────────────────────────────────────────────────────────────────

async function onSearch(event: { query: string }) {
  const query = event.query.trim()
  currentQuery.value = query
  searching.value = true
  statusMessage.value = ''
  if (statusClearTimer) { clearTimeout(statusClearTimer); statusClearTimer = null }

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

    if (suggestions.value.length === 0) {
      statusMessage.value = `No results for "${query}"`
    } else {
      statusMessage.value = `${suggestions.value.length} result${suggestions.value.length === 1 ? '' : 's'} for "${query}"`
    }
    statusClearTimer = setTimeout(() => { statusMessage.value = '' }, 3000)
  } catch {
    suggestions.value = []
    statusMessage.value = 'Search failed — check your connection'
    statusClearTimer = setTimeout(() => { statusMessage.value = '' }, 4000)
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

.autocomplete-wrap {
  transition: box-shadow var(--rf-duration-base) var(--rf-ease-out);
  border-radius: var(--rf-radius-md);
}

.autocomplete-wrap--searching :deep(.p-autocomplete-input) {
  border-color: var(--rf-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rf-primary) 25%, transparent);
}

.search-status {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  min-height: 1.25rem;
}

.search-status-icon {
  color: var(--rf-primary);
  font-size: 0.7rem;
  flex-shrink: 0;
}

.status-fade-enter-active,
.status-fade-leave-active {
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}

.status-fade-enter-from,
.status-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
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

.selected-chip--locked {
  opacity: 0.6;
  cursor: default;
}

.selected-chip--locked:hover {
  border-color: var(--rf-border);
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
