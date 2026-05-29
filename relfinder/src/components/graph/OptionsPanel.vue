<template>
  <div class="options-panel">
    <!-- Label language -->
    <div class="option-group">
      <button class="section-toggle" @click="open.language = !open.language">
        <span class="option-label">Label Language</span>
        <span v-if="!open.language && modelValue.language" class="section-badge">{{
          modelValue.language
        }}</span>
        <i
          class="pi pi-chevron-right toggle-chevron"
          :class="{ 'toggle-chevron--open': open.language }"
        />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.language }">
        <div class="section-body-inner">
          <Select
            v-if="availableLanguages && availableLanguages.length > 0"
            inputId="opt-language"
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

    <!-- Hide node types -->
    <div class="option-group">
      <button class="section-toggle" @click="open.classFilter = !open.classFilter">
        <span class="option-label">Hide Node Types</span>
        <span
          v-if="!open.classFilter && modelValue.hiddenClasses.length > 0"
          class="section-badge"
          >{{ modelValue.hiddenClasses.length }}</span
        >
        <i
          class="pi pi-chevron-right toggle-chevron"
          :class="{ 'toggle-chevron--open': open.classFilter }"
        />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.classFilter }">
        <div class="section-body-inner">
          <p class="option-hint">
            Select node types to remove from the graph view. Changes apply instantly without
            re-querying.
          </p>
          <div v-if="modelValue.hiddenClasses.length > 0" class="chip-list">
            <div v-for="(iri, idx) in modelValue.hiddenClasses" :key="iri" class="prop-chip">
              <span class="prop-chip-label" :title="iri">{{ shortIri(iri) }}</span>
              <button class="chip-remove" @click="removeClass(idx)" aria-label="Remove">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
          <div class="add-prop">
            <Select
              inputId="opt-class-filter"
              v-model="classPickerValue"
              :options="unselectedClasses"
              option-label="label"
              option-value="iri"
              placeholder="Add class filter…"
              :loading="!graphClasses && loadingClasses"
              filter
              filter-placeholder="Search types…"
              :filter-input-props="{
                id: 'opt-class-filter-search',
                'aria-label': 'Search node types',
              }"
              :empty-message="
                loadingClasses
                  ? 'Loading…'
                  : classLoadError ||
                    (graphClasses?.length === 0
                      ? 'No classes in current graph'
                      : 'No classes found')
              "
              size="small"
              fluid
              @show="onDropdownShow"
              @change="onClassSelect"
            />
          </div>
          <Message
            v-if="!graphClasses && classLoadError"
            severity="warn"
            :closable="false"
            class="class-error"
          >
            {{ classLoadError }}
          </Message>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
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
  /** Class IRIs whose nodes should be hidden from the displayed graph. */
  hiddenClasses: string[]
  language: string
  customLabelProperties: string[]
}

const props = defineProps<{
  modelValue: GraphOptions
  /** Distinct language tags present in the current graph's labels. */
  availableLanguages?: string[]
  /** rdf:type IRIs present in the current graph. When provided, the class
   *  filter dropdown is populated from these instead of querying the endpoint. */
  graphClasses?: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: GraphOptions] }>()

const connectionStore = useConnectionStore()

const open = reactive({
  language: false,
  classFilter: false,
})

const classPickerValue = ref<string | null>(null)
const _endpointClasses = ref<{ iri: string; label: string }[]>([])
const loadingClasses = ref(false)
const classesLoaded = ref(false)
const classLoadError = ref('')

const availableClasses = computed<{ iri: string; label: string }[]>(() => {
  if (props.graphClasses) {
    return props.graphClasses
      .map((iri) => ({ iri, label: shortIri(iri) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  return _endpointClasses.value
})

// Only show classes not already hidden
const unselectedClasses = computed(() =>
  availableClasses.value.filter((cls) => !props.modelValue.hiddenClasses.includes(cls.iri)),
)

const _displayNames = new Intl.DisplayNames(['en'], { type: 'language' })

function langLabel(code: string): string {
  try {
    const name = _displayNames.of(code)
    return name && name !== code ? `${name} (${code})` : code
  } catch {
    return code
  }
}

const langOptions = computed(() => [
  { label: 'Any', value: '' },
  ...(props.availableLanguages ?? [])
    .filter((l) => l !== '')
    .map((l) => ({ label: langLabel(l), value: l })),
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
    const client = connectionStore.sparqlClient
    if (!client) throw new Error('No active connection')

    const iris = await fetchAvailableClasses(client, 50)
    _endpointClasses.value = iris
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
  if (!props.graphClasses && !classesLoaded.value) loadClasses()
}

function onClassSelect(event: { value: string }) {
  const iri = event.value
  if (!iri || props.modelValue.hiddenClasses.includes(iri)) return
  update('hiddenClasses', [...props.modelValue.hiddenClasses, iri])
  classPickerValue.value = null
}

function removeClass(idx: number) {
  const updated = [...props.modelValue.hiddenClasses]
  updated.splice(idx, 1)
  update('hiddenClasses', updated)
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
  padding: 0;
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.7rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
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
  min-height: 44px;
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
