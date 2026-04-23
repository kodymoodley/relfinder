<template>
  <div class="query-options-panel">
    <!-- Max distance -->
    <div class="option-group">
      <div class="option-header">
        <span class="option-label">Max Path Length</span>
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

    <!-- Avoid cycles -->
    <div class="option-group">
      <div class="switch-row">
        <span class="option-label">Avoid Cycles</span>
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

    <!-- Extra label properties -->
    <div class="option-group">
      <button class="section-toggle" @click="open.customLabels = !open.customLabels">
        <span class="option-label">Extra Label Properties</span>
        <span v-if="!open.customLabels && modelValue.customLabelProperties.length > 0" class="section-badge">{{ modelValue.customLabelProperties.length }}</span>
        <i class="pi pi-chevron-right toggle-chevron" :class="{ 'toggle-chevron--open': open.customLabels }" />
      </button>
      <div class="section-body" :class="{ 'section-body--open': open.customLabels }">
        <div class="section-body-inner">
          <p class="option-hint">
            Additional predicate IRIs to use as labels (e.g.
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import Slider from 'primevue/slider'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import ToggleButton from 'primevue/togglebutton'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import { shortIri } from '@/lib/utils/iri'

export interface QueryConfig {
  maxDistance: number
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
  customLabelProperties: string[]
}

const props = defineProps<{ modelValue: QueryConfig }>()
const emit = defineEmits<{ 'update:modelValue': [value: QueryConfig] }>()

const open = reactive({ ignoredProps: false, customLabels: false })
const newPropIri = ref('')
const newLabelIri = ref('')

function update<K extends keyof QueryConfig>(key: K, value: QueryConfig[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function isValidIri(iri: string): boolean {
  try {
    const url = new URL(iri)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

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
.query-options-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  padding: var(--rf-space-4) var(--rf-space-5);
  border-top: 1px solid var(--rf-border);
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

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.option-hint {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

.option-hint code {
  font-family: var(--rf-font-mono);
  font-size: 0.85em;
  background: var(--rf-surface-raised);
  color: var(--rf-primary);
  padding: 0.1em 0.35em;
  border-radius: var(--rf-radius-sm);
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
</style>
