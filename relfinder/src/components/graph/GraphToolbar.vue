<template>
  <div class="canvas-toolbar">
    <Button
      v-tooltip.top="'Zoom in'"
      icon="pi pi-plus"
      text
      rounded
      size="small"
      aria-label="Zoom in"
      @click="emit('zoom-in')"
    />
    <Button
      v-tooltip.top="'Zoom out'"
      icon="pi pi-minus"
      text
      rounded
      size="small"
      aria-label="Zoom out"
      @click="emit('zoom-out')"
    />
    <button
      v-tooltip.top="'Reset zoom to 100%'"
      class="zoom-level-btn"
      aria-label="Reset zoom to 100%"
      @click="emit('reset-zoom')"
    >
      {{ zoomLevel }}%
    </button>
    <Button
      v-tooltip.top="'Fit graph to screen'"
      icon="pi pi-arrows-alt"
      text
      rounded
      size="small"
      aria-label="Fit graph"
      @click="emit('fit-graph')"
    />
    <Divider layout="vertical" />
    <Button
      v-tooltip.top="'Re-run force layout'"
      icon="pi pi-refresh"
      text
      rounded
      size="small"
      aria-label="Re-run layout"
      @click="emit('rerun-layout')"
    />
    <Divider layout="vertical" />
    <Button
      v-tooltip.top="showEdgeLabels ? 'Hide edge labels' : 'Show edge labels'"
      :icon="showEdgeLabels ? 'pi pi-eye' : 'pi pi-eye-slash'"
      text
      rounded
      size="small"
      :style="{ opacity: showEdgeLabels ? 1 : 0.45 }"
      :aria-label="showEdgeLabels ? 'Hide edge labels' : 'Show edge labels'"
      @click="emit('toggle-edge-labels')"
    />
    <Divider layout="vertical" />
    <Button
      v-tooltip.top="selectionMode === 'select' ? 'Back to pan mode' : 'Select subgraph'"
      icon="pi pi-expand"
      text
      rounded
      size="small"
      :style="{ color: selectionMode === 'select' ? 'var(--rf-primary)' : undefined }"
      :aria-label="selectionMode === 'select' ? 'Back to pan mode' : 'Box select to focus labels'"
      @click="emit('toggle-selection-mode')"
    />
    <template v-if="hasSelection">
      <Divider layout="vertical" />
      <Button
        v-tooltip.top="'Filter subgraph'"
        icon="pi pi-filter"
        text
        rounded
        size="small"
        aria-label="Crop to selection"
        @click="emit('crop-to-selection')"
      />
    </template>
    <template v-if="hasCropHistory">
      <Divider layout="vertical" />
      <Button
        v-tooltip.top="'Undo filtering'"
        icon="pi pi-undo"
        text
        rounded
        size="small"
        aria-label="Undo crop"
        @click="emit('undo-crop')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import Button from 'primevue/button'
import Divider from 'primevue/divider'

defineProps<{
  zoomLevel: number
  showEdgeLabels: boolean
  selectionMode: 'pan' | 'select'
  hasSelection: boolean
  hasCropHistory: boolean
}>()

const emit = defineEmits<{
  'zoom-in': []
  'zoom-out': []
  'reset-zoom': []
  'fit-graph': []
  'rerun-layout': []
  'toggle-edge-labels': []
  'toggle-selection-mode': []
  'crop-to-selection': []
  'undo-crop': []
}>()
</script>
