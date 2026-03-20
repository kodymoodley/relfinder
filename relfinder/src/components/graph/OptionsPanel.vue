<template>
  <div class="options-panel">
    <!-- Max distance -->
    <div class="option-group">
      <div class="option-header">
        <label class="option-label">Max Path Length</label>
        <span class="option-value">{{ modelValue.maxDistance }}</span>
      </div>
      <Slider
        :model-value="modelValue.maxDistance"
        :min="1"
        :max="6"
        :step="1"
        class="distance-slider"
        @update:model-value="update('maxDistance', $event as number)"
      />
      <div class="slider-ticks">
        <span v-for="n in 6" :key="n">{{ n }}</span>
      </div>
    </div>

    <!-- Label language -->
    <div class="option-group">
      <label class="option-label" for="lang-input">Label Language</label>
      <p class="option-hint">
        RDF language tag for labels (e.g. <code>en</code>, <code>de</code>, <code>fr</code>).
        Leave empty to accept any language.
      </p>
      <InputText
        id="lang-input"
        :model-value="modelValue.language"
        placeholder="en"
        size="small"
        style="width: 80px"
        @update:model-value="update('language', $event as string)"
      />
    </div>

    <!-- Custom label properties -->
    <div class="option-group">
      <label class="option-label">Extra Label Properties</label>
      <p class="option-hint">
        Additional predicate IRIs to use as labels when searching entities
        (e.g. <code>http://schema.org/alternateName</code>).
      </p>

      <div v-if="modelValue.customLabelProperties.length > 0" class="chip-list">
        <div
          v-for="(iri, idx) in modelValue.customLabelProperties"
          :key="iri"
          class="prop-chip"
        >
          <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
          <button class="chip-remove" @click="removeCustomLabel(idx)" aria-label="Remove">
            <i class="pi pi-times" />
          </button>
        </div>
      </div>

      <div class="add-prop">
        <InputText
          v-model="newLabelIri"
          placeholder="https://example.org/label"
          size="small"
          fluid
          @keydown.enter.prevent="addCustomLabel"
        />
        <Button
          icon="pi pi-plus"
          severity="secondary"
          size="small"
          :disabled="!newLabelIri.trim()"
          @click="addCustomLabel"
          aria-label="Add label property"
        />
      </div>
    </div>

    <!-- Entity class filter -->
    <div class="option-group">
      <label class="option-label">Entity Class Filter</label>
      <p class="option-hint">Restrict entity search to specific RDF types. Leave empty to allow all.</p>

      <div v-if="modelValue.allowedClasses.length > 0" class="chip-list">
        <div
          v-for="(iri, idx) in modelValue.allowedClasses"
          :key="iri"
          class="prop-chip"
        >
          <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
          <button class="chip-remove" @click="removeClass(idx)" aria-label="Remove">
            <i class="pi pi-times" />
          </button>
        </div>
      </div>

      <div class="add-prop">
        <Select
          v-model="classPickerValue"
          :options="unselectedClasses"
          option-label="label"
          option-value="iri"
          placeholder="Add class filter…"
          :loading="loadingClasses"
          filter
          filter-placeholder="Search types…"
          :empty-message="loadingClasses ? 'Loading…' : classLoadError || 'No classes found'"
          size="small"
          fluid
          @show="onDropdownShow"
          @change="onClassSelect"
        />
      </div>

      <Message v-if="classLoadError" severity="warn" :closable="false" class="class-error">
        {{ classLoadError }}
      </Message>
    </div>

    <!-- Ignored properties -->
    <div class="option-group">
      <label class="option-label">Ignored Properties</label>
      <p class="option-hint">Property IRIs excluded from all paths.</p>
      <div class="chip-list">
        <div
          v-for="(iri, idx) in modelValue.ignoredProperties"
          :key="iri"
          class="prop-chip"
        >
          <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
          <button class="chip-remove" @click="removeIgnoredProp(idx)" aria-label="Remove">
            <i class="pi pi-times" />
          </button>
        </div>
      </div>
      <div class="add-prop">
        <InputText
          v-model="newPropIri"
          placeholder="https://example.org/property"
          size="small"
          fluid
          @keydown.enter.prevent="addIgnoredProp"
        />
        <Button
          icon="pi pi-plus"
          severity="secondary"
          size="small"
          :disabled="!newPropIri.trim()"
          @click="addIgnoredProp"
          aria-label="Add property"
        />
      </div>
    </div>

    <!-- Cycle avoidance -->
    <div class="option-group">
      <label class="option-label">Cycle Avoidance</label>
      <SelectButton
        class="cycle-toggle"
        :model-value="modelValue.avoidCycles"
        :options="cycleOptions"
        option-label="label"
        option-value="value"
        @update:model-value="update('avoidCycles', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Slider from 'primevue/slider'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import Message from 'primevue/message'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import { fetchAvailableClasses } from '@/lib/sparql/entitySearch'
import { useConnectionStore } from '@/stores/connection'

export interface GraphOptions {
  maxDistance: number
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
  allowedClasses: string[]
  language: string
  customLabelProperties: string[]
}

const props = defineProps<{ modelValue: GraphOptions }>()
const emit = defineEmits<{ 'update:modelValue': [value: GraphOptions] }>()

const connectionStore = useConnectionStore()

const newPropIri = ref('')
const newLabelIri = ref('')
const classPickerValue = ref<string | null>(null)
const availableClasses = ref<{ iri: string; label: string }[]>([])
const loadingClasses = ref(false)
const classesLoaded = ref(false)
const classLoadError = ref('')

const cycleOptions = [
  { label: 'Off', value: QueryCyclesStrategy.NONE },
  { label: 'On', value: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES },
]

// Only show classes not already selected
const unselectedClasses = computed(() =>
  availableClasses.value.filter(
    (cls) => !props.modelValue.allowedClasses.includes(cls.iri),
  ),
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function update<K extends keyof GraphOptions>(key: K, value: GraphOptions[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}

// ── Class filter ──────────────────────────────────────────────────────────────

async function loadClasses() {
  if (loadingClasses.value) return
  loadingClasses.value = true
  classLoadError.value = ''

  try {
    const context = connectionStore.queryContext
    const store = connectionStore.rdfStore ?? undefined
    const effectiveContext = context ?? { endpointUrl: '' }

    const iris = await fetchAvailableClasses(effectiveContext, 50, store)
    availableClasses.value = iris
      .map((iri) => ({ iri, label: shortIri(iri) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    classesLoaded.value = true
  } catch (err) {
    classLoadError.value =
      err instanceof Error ? err.message : 'Could not load classes.'
  } finally {
    loadingClasses.value = false
  }
}

function onDropdownShow() {
  if (!classesLoaded.value) loadClasses()
}

function onClassSelect(event: { value: string }) {
  const iri = event.value
  if (!iri || props.modelValue.allowedClasses.includes(iri)) return
  update('allowedClasses', [...props.modelValue.allowedClasses, iri])
  // Reset the picker so the same class can be re-added after removal
  classPickerValue.value = null
}

function removeClass(idx: number) {
  const updated = [...props.modelValue.allowedClasses]
  updated.splice(idx, 1)
  update('allowedClasses', updated)
}

// ── Ignored properties ────────────────────────────────────────────────────────

function addIgnoredProp() {
  const iri = newPropIri.value.trim()
  if (!iri || props.modelValue.ignoredProperties.includes(iri)) return
  update('ignoredProperties', [...props.modelValue.ignoredProperties, iri])
  newPropIri.value = ''
}

function removeIgnoredProp(idx: number) {
  const updated = [...props.modelValue.ignoredProperties]
  updated.splice(idx, 1)
  update('ignoredProperties', updated)
}

// ── Custom label properties ───────────────────────────────────────────────────

function addCustomLabel() {
  const iri = newLabelIri.value.trim()
  if (!iri || props.modelValue.customLabelProperties.includes(iri)) return
  update('customLabelProperties', [...props.modelValue.customLabelProperties, iri])
  newLabelIri.value = ''
}

function removeCustomLabel(idx: number) {
  const updated = [...props.modelValue.customLabelProperties]
  updated.splice(idx, 1)
  update('customLabelProperties', updated)
}
</script>

<style scoped>
.options-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.option-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.option-value {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.option-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  line-height: 1.4;
}

.distance-slider {
  margin: 0.25rem 0;
}

.slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  padding: 0 2px;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.prop-chip {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  background: var(--p-surface-100);
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  font-size: 0.75rem;
  max-width: 200px;
}

.prop-chip-label {
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
  font-size: 0.6rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.chip-remove:hover {
  color: var(--p-red-500);
}

.add-prop {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.class-error {
  font-size: 0.78rem;
}

.option-hint code {
  font-family: monospace;
  font-size: 0.85em;
  background: var(--p-surface-200);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

/* ── Cycle avoidance toggle ───────────────────────────────────────────────── */

.cycle-toggle {
  display: inline-flex;
}

.cycle-toggle :deep(.p-selectbutton) {
  display: inline-flex;
  gap: 0.3rem;
  background: none;
  border: none;
  padding: 0;
}

.cycle-toggle :deep(.p-togglebutton) {
  padding: 0.28rem 0.85rem;
  font-size: 0.78rem;
  font-weight: 500;
  border-radius: 9999px;
  border: 1px solid var(--p-content-border-color);
  background: var(--p-surface-100);
  color: var(--p-text-muted-color);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  cursor: pointer;
  white-space: nowrap;
}

.cycle-toggle :deep(.p-togglebutton:hover:not(.p-togglebutton-checked)) {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
  background: var(--p-surface-50);
}

.cycle-toggle :deep(.p-togglebutton-checked) {
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
  color: #ffffff;
  font-weight: 600;
}
</style>
