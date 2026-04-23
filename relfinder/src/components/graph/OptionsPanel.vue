<template>
  <div class="options-panel">
    <!-- Max distance -->
    <div class="option-group">
      <div class="option-header">
        <label class="option-label">Max Path Length</label>
        <span class="option-value">{{ modelValue.maxDistance }}</span>
      </div>
      <!-- Max 6: at distance 6 the query fan-out (2^6 query blocks) is already
           very large; higher values cause timeouts on most public endpoints. -->
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
      <button class="section-toggle" @click="open.language = !open.language">
        <span class="option-label">Label Language</span>
        <span v-if="!open.language && modelValue.language" class="section-badge">{{ modelValue.language }}</span>
        <i class="pi pi-chevron-right toggle-chevron" :class="{ 'toggle-chevron--open': open.language }" />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.language }">
        <div class="section-body-inner">
          <Select
            v-if="availableLanguages && availableLanguages.length > 0"
            :model-value="modelValue.language"
            :options="langOptions"
            option-label="label"
            option-value="value"
            size="small"
            fluid
            @update:model-value="update('language', $event as string)"
          />
          <InputText
            v-else
            id="lang-input"
            :model-value="modelValue.language"
            placeholder="en"
            size="small"
            style="width: 80px"
            @update:model-value="update('language', $event as string)"
          />
        </div>
      </div>
    </div>

    <!-- Custom label properties -->
    <div class="option-group">
      <button class="section-toggle" @click="open.customLabels = !open.customLabels">
        <span class="option-label">Extra Label Properties</span>
        <span v-if="!open.customLabels && modelValue.customLabelProperties.length > 0" class="section-badge">{{ modelValue.customLabelProperties.length }}</span>
        <i class="pi pi-chevron-right toggle-chevron" :class="{ 'toggle-chevron--open': open.customLabels }" />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.customLabels }">
        <div class="section-body-inner">
          <p class="option-hint">
            Additional predicate IRIs to use as labels when searching entities (e.g.
            <code>http://schema.org/alternateName</code>).
          </p>
          <div v-if="modelValue.customLabelProperties.length > 0" class="chip-list">
            <div v-for="(iri, idx) in modelValue.customLabelProperties" :key="iri" class="prop-chip">
              <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
              <button class="chip-remove" @click="removeCustomLabel(idx)" aria-label="Remove">
                <span aria-hidden="true">×</span>
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
      </div>
    </div>

    <!-- Entity class filter -->
    <div class="option-group">
      <button class="section-toggle" @click="open.classFilter = !open.classFilter">
        <span class="option-label">Entity Class Filter</span>
        <span v-if="!open.classFilter && modelValue.allowedClasses.length > 0" class="section-badge">{{ modelValue.allowedClasses.length }}</span>
        <i class="pi pi-chevron-right toggle-chevron" :class="{ 'toggle-chevron--open': open.classFilter }" />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.classFilter }">
        <div class="section-body-inner">
          <p class="option-hint">
            Restrict entity search to specific RDF types. Leave empty to allow all.
          </p>
          <div v-if="modelValue.allowedClasses.length > 0" class="chip-list">
            <div v-for="(iri, idx) in modelValue.allowedClasses" :key="iri" class="prop-chip">
              <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
              <button class="chip-remove" @click="removeClass(idx)" aria-label="Remove">
                <span aria-hidden="true">×</span>
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
      </div>
    </div>

    <!-- Ignored properties -->
    <div class="option-group">
      <button class="section-toggle" @click="open.ignoredProps = !open.ignoredProps">
        <span class="option-label">Ignored Properties</span>
        <span v-if="!open.ignoredProps && modelValue.ignoredProperties.length > 0" class="section-badge">{{ modelValue.ignoredProperties.length }}</span>
        <i class="pi pi-chevron-right toggle-chevron" :class="{ 'toggle-chevron--open': open.ignoredProps }" />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.ignoredProps }">
        <div class="section-body-inner">
          <p class="option-hint">Property IRIs excluded from all paths.</p>
          <div class="chip-list">
            <div v-for="(iri, idx) in modelValue.ignoredProperties" :key="iri" class="prop-chip">
              <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
              <button class="chip-remove" @click="removeIgnoredProp(idx)" aria-label="Remove">
                <span aria-hidden="true">×</span>
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
      </div>
    </div>

    <!-- Cycle avoidance -->
    <div class="option-group">
      <div class="switch-row">
        <label class="option-label">Avoid Cycles</label>
        <ToggleButton
          :model-value="modelValue.avoidCycles !== QueryCyclesStrategy.NONE"
          on-label="On"
          off-label="Off"
          on-icon="pi pi-check"
          off-icon="pi pi-times"
          size="small"
          @update:model-value="update('avoidCycles', $event ? QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES : QueryCyclesStrategy.NONE)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import Slider from 'primevue/slider'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'
import Message from 'primevue/message'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import { fetchAvailableClasses } from '@/lib/sparql/entitySearch'
import { useConnectionStore } from '@/stores/connection'
import { shortIri } from '@/lib/utils/iri'

export interface GraphOptions {
  maxDistance: number
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
  allowedClasses: string[]
  language: string
  customLabelProperties: string[]
}

const props = defineProps<{
  modelValue: GraphOptions
  /** Distinct language tags present in the current graph's labels. When provided,
   *  a dropdown replaces the free-text input. */
  availableLanguages?: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: GraphOptions] }>()

const connectionStore = useConnectionStore()

const open = reactive({
  language: false,
  customLabels: false,
  classFilter: false,
  ignoredProps: false,
})

const newPropIri = ref('')
const newLabelIri = ref('')
const classPickerValue = ref<string | null>(null)
const availableClasses = ref<{ iri: string; label: string }[]>([])
const loadingClasses = ref(false)
const classesLoaded = ref(false)
const classLoadError = ref('')

// Only show classes not already selected
const unselectedClasses = computed(() =>
  availableClasses.value.filter((cls) => !props.modelValue.allowedClasses.includes(cls.iri)),
)

const langOptions = computed(() => [
  { label: 'Any', value: '' },
  ...(props.availableLanguages ?? [])
    .filter((l) => l !== '')
    .map((l) => ({ label: l, value: l })),
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function update<K extends keyof GraphOptions>(key: K, value: GraphOptions[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

// ── Class filter ──────────────────────────────────────────────────────────────

async function loadClasses() {
  if (loadingClasses.value) return
  loadingClasses.value = true
  classLoadError.value = ''

  try {
    const context = connectionStore.queryContext
    const store = connectionStore.rdfStore ?? undefined
    // In file mode context is null; the empty URL fallback is never used
    // because Comunica queries the in-memory store directly.
    const effectiveContext = context ?? { endpointUrl: '' }

    const iris = await fetchAvailableClasses(effectiveContext, 50, store)
    availableClasses.value = iris
      .map((iri) => ({ iri, label: shortIri(iri) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    classesLoaded.value = true
  } catch (err) {
    classLoadError.value = err instanceof Error ? err.message : 'Could not load classes.'
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

// ── IRI validation ────────────────────────────────────────────────────────────

/** Checks that an IRI is an absolute URL — rejects relative and blank values. */
function isValidIri(iri: string): boolean {
  try {
    const url = new URL(iri)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// ── Ignored properties ────────────────────────────────────────────────────────

function addIgnoredProp() {
  const iri = newPropIri.value.trim()
  if (!iri || !isValidIri(iri) || props.modelValue.ignoredProperties.includes(iri)) return
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
  if (!iri || !isValidIri(iri) || props.modelValue.customLabelProperties.includes(iri)) return
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
  gap: 0;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  padding-top: var(--rf-space-4);
  padding-bottom: var(--rf-space-4);
  border-top: 1px solid var(--rf-border);
}

.option-group:first-child {
  border-top: none;
  padding-top: 0;
}

.option-group:last-child {
  padding-bottom: 0;
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
  padding: 0 0 0 var(--rf-space-1);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.7rem;
  line-height: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.5;
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    opacity var(--rf-duration-fast) var(--rf-ease-out);
}

.chip-remove:hover {
  color: var(--rf-danger);
  opacity: 1;
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

/* ── Collapsible sections ────────────────────────────────────────────────── */

.section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.section-toggle:hover .option-label {
  color: var(--rf-primary);
}

.section-badge {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  background: var(--rf-primary-soft);
  color: var(--rf-primary);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 30%, transparent);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.45rem;
  letter-spacing: 0.02em;
  line-height: 1.6;
}

.toggle-chevron {
  margin-left: auto;
  font-size: 0.55rem;
  color: var(--rf-text-subtle);
  transition:
    transform var(--rf-duration-base) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out);
  flex-shrink: 0;
}

.section-toggle:hover .toggle-chevron {
  color: var(--rf-primary);
}

.toggle-chevron--open {
  transform: rotate(90deg);
}

.section-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--rf-duration-base) var(--rf-ease-out);
}

.section-body--open {
  grid-template-rows: 1fr;
}

.section-body-inner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  padding-top: var(--rf-space-2);
}

/* ── Cycle avoidance switch ───────────────────────────────────────────────── */

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.switch-row .option-label {
  cursor: pointer;
}

.switch-row :deep(.p-togglebutton) {
  font-size: var(--rf-text-xs);
  padding: 0.3rem 0.7rem;
}

.switch-row :deep(.p-togglebutton-checked) {
  background: var(--rf-primary-soft);
  border-color: var(--rf-primary);
  color: var(--rf-primary);
}
</style>
