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
  gap: var(--rf-space-6);
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.option-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-label {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.option-value {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-bold);
  color: var(--rf-primary);
}

.option-hint {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

.distance-slider {
  margin: var(--rf-space-1) 0;
}

.slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  padding: 0 2px;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rf-space-2);
}

.prop-chip {
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  padding: var(--rf-space-1) var(--rf-space-3);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-sm);
  font-size: var(--rf-text-xs);
  max-width: 200px;
  transition: border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.prop-chip:hover {
  border-color: var(--rf-border-strong);
}

.prop-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rf-text-muted);
}

.chip-remove {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.6rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.chip-remove:hover {
  color: var(--rf-danger);
}

.add-prop {
  display: flex;
  gap: var(--rf-space-2);
  align-items: center;
}

.class-error {
  font-size: var(--rf-text-xs);
}

.option-hint code {
  font-family: var(--rf-font-mono);
  font-size: 0.85em;
  background: var(--rf-surface-raised);
  color: var(--rf-primary);
  padding: 0.1em 0.35em;
  border-radius: var(--rf-radius-sm);
}

/* ── Cycle avoidance toggle ───────────────────────────────────────────────── */

.cycle-toggle {
  display: inline-flex;
}

.cycle-toggle :deep(.p-selectbutton) {
  display: inline-flex;
  gap: var(--rf-space-1);
  background: none;
  border: none;
  padding: 0;
}

.cycle-toggle :deep(.p-togglebutton) {
  padding: 0.28rem 0.85rem;
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  border-radius: var(--rf-radius-full);
  border: 1px solid var(--rf-border);
  background: var(--rf-surface-raised);
  color: var(--rf-text-muted);
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
  cursor: pointer;
  white-space: nowrap;
}

.cycle-toggle :deep(.p-togglebutton:hover:not(.p-togglebutton-checked)) {
  border-color: var(--rf-primary);
  color: var(--rf-primary);
  background: var(--rf-primary-soft);
}

.cycle-toggle :deep(.p-togglebutton-checked) {
  background: var(--rf-primary);
  border-color: var(--rf-primary);
  color: var(--rf-text-on-primary);
  font-weight: var(--rf-weight-semibold);
}
</style>
