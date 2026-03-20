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
import { ref } from 'vue'
import Slider from 'primevue/slider'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import { QueryCyclesStrategy } from '@/lib/sparql/types'

export interface GraphOptions {
  maxDistance: number
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
}

const props = defineProps<{ modelValue: GraphOptions }>()
const emit = defineEmits<{ 'update:modelValue': [value: GraphOptions] }>()

const newPropIri = ref('')

const cycleOptions = [
  { label: 'Off', value: QueryCyclesStrategy.NONE },
  { label: 'No duplicates', value: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function update<K extends keyof GraphOptions>(key: K, value: GraphOptions[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}

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
</style>
