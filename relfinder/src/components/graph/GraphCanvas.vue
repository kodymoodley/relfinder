<template>
  <div class="graph-canvas-wrapper">
    <!-- Empty state -->
    <GraphEmptyState v-if="!hasGraph && !loading" />

    <!-- Loading overlay -->
    <GraphLoadingOverlay
      v-if="loading"
      :entity1-label="entity1Label"
      :entity2-label="entity2Label"
    />

    <!-- Cytoscape mount point — always in the DOM so cy can attach -->
    <div
      ref="cyContainer"
      class="cy-container"
      :class="{ hidden: !hasGraph }"
      role="application"
      aria-label="Relationship graph — use mouse or touch to pan, zoom, and click nodes"
      data-testid="graph-canvas"
    />

    <!-- Class legend (shown when ≥ 2 distinct classes are present) -->
    <GraphLegend v-if="hasGraph" :entries="legendEntries" />

    <!-- Select mode indicator -->
    <Transition name="mode-badge">
      <div v-if="selectionMode === 'select'" class="select-mode-badge">
        <i class="pi pi-expand" />
        Drag to select
      </div>
    </Transition>

    <!-- Toolbar (zoom controls) -->
    <GraphToolbar
      v-if="hasGraph"
      :zoom-level="zoomLevel"
      :show-edge-labels="showEdgeLabels"
      :selection-mode="selectionMode"
      :has-selection="hasSelection"
      :has-crop-history="cropHistory.length > 0"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
      @fit-graph="fitGraph"
      @rerun-layout="rerunLayout"
      @toggle-edge-labels="toggleEdgeLabels"
      @toggle-selection-mode="toggleSelectionMode"
      @crop-to-selection="cropToSelection"
      @undo-crop="undoCrop"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useDarkMode } from '@/composables/useDarkMode'
import { prefersReducedMotion } from '@/composables/useReducedMotion'
import { useTouchBoxSelect } from '@/composables/useTouchBoxSelect'
import cytoscape from 'cytoscape'
import type { Core, NodeSingular, Layouts } from 'cytoscape'
import d3Force from 'cytoscape-d3-force'
import type { GraphNode, MergedEdge } from '@/lib/sparql/types'
import GraphEmptyState from './GraphEmptyState.vue'
import GraphLoadingOverlay from './GraphLoadingOverlay.vue'
import GraphLegend from './GraphLegend.vue'
import GraphToolbar from './GraphToolbar.vue'

cytoscape.use(d3Force as unknown as cytoscape.Ext)

// ── Props / emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  nodes: GraphNode[]
  edges: MergedEdge[]
  loading: boolean
  classColors: Map<string, string>
  endpoint1Iri?: string
  endpoint2Iri?: string
  entity1Label?: string
  entity2Label?: string
}>()

const emit = defineEmits<{
  nodeClick: [node: GraphNode]
}>()

// ── Cytoscape instance ────────────────────────────────────────────────────────

const cyContainer = ref<HTMLElement | null>(null)
let cy: Core | null = null
let layout: Layouts | null = null
let resizeObserver: ResizeObserver | null = null

const { dark } = useDarkMode()

const hasGraph = ref(false)
const showEdgeLabels = ref(false)
const selectionMode = ref<'pan' | 'select'>('pan')
const hasSelection = ref(false)
const cropHistory = ref<cytoscape.ElementDefinition[][]>([])
const zoomLevel = ref(100)
// ── Touch box-selection (long-press → drag on mobile) ─────────────────────────

const { attach: attachTouchSelect, detach: detachTouchSelect } = useTouchBoxSelect(
  () => cy,
  () => cyContainer.value,
  () => {
    selectionMode.value = 'select'
    if (cy) {
      cy.userPanningEnabled(false)
      cy.boxSelectionEnabled(true)
    }
  },
  () => {
    // Re-enable panning but keep the selection visible so the user can crop.
    selectionMode.value = 'pan'
    if (cy) {
      cy.userPanningEnabled(true)
      cy.boxSelectionEnabled(false)
    }
  },
)

// Keep a stable reference to the container so we can detach in onUnmounted
// (template refs are nulled before onUnmounted fires in Vue 3).
let touchSelectEl: HTMLElement | null = null

const legendEntries = computed(() => {
  const seen = new Map<string, string>()
  for (const node of props.nodes) {
    if (!seen.has(node.class)) {
      seen.set(node.class, props.classColors.get(node.class) ?? '#71717a')
    }
  }
  return Array.from(seen.entries()).map(([iri, color]) => ({
    iri,
    label: iri.split(/[#/]/).pop() ?? iri,
    color,
  }))
})

// Colour palette for node classes — matches --rf-cat-* tokens in tokens.css
const PALETTE = [
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#a78bfa', // violet
  '#facc15', // yellow
  '#f472b6', // pink
  '#f87171', // red
  '#60a5fa', // blue
  '#a3e635', // lime
]

function nodeColor(ele: NodeSingular): string {
  return props.classColors.get(ele.data('class') as string) ?? '#71717a'
}

// ── Graph rendering ───────────────────────────────────────────────────────────

// Prefix node IDs with "n" so they are unambiguously strings. Purely numeric
// IDs like "2" can be coerced to the number 2 inside cytoscape-d3-force's D3
// forceLink lookup, causing a Map key mismatch and a "node not found" error.
function nodeId(id: number) {
  return `n${id}`
}

function buildElements() {
  const nodeEls = props.nodes.map((n) => ({
    data: {
      id: nodeId(n.id),
      label: n.label,
      iri: n.iri,
      class: n.class,
      isEndpoint: n.isEndpoint,
    },
  }))

  const edgeEls = props.edges.map((e, idx) => ({
    data: {
      id: `e${idx}`,
      source: nodeId(e.sid),
      target: nodeId(e.tid),
      label: e.label,
      iris: e.iris,
    },
  }))

  return [...nodeEls, ...edgeEls]
}

function initCytoscape() {
  if (!cyContainer.value) return

  cy?.destroy()
  cropHistory.value = []
  hasSelection.value = false

  cy = cytoscape({
    container: cyContainer.value,
    elements: buildElements(),
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': (ele: NodeSingular) => nodeColor(ele),
          color: '#ffffff',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '9px',
          'font-family': 'Syne, DM Sans, system-ui, sans-serif',
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-max-width': '30px',
          width: 60,
          height: 60,
          'border-width': 0,
          'text-outline-width': 1.5,
          'text-outline-color': 'rgba(0,0,0,0.3)',
          'transition-property': 'width height border-width border-color',
          'transition-duration': prefersReducedMotion() ? 0 : 120,
          'transition-timing-function': 'ease-out',
        },
      },
      {
        selector: 'node.hovered',
        style: {
          width: 70,
          height: 70,
          'border-width': 2.5,
          'border-color': 'rgba(255,255,255,0.7)',
          'border-style': 'solid',
        },
      },
      {
        selector: 'node[?isEndpoint].hovered',
        style: {
          width: 86,
          height: 86,
        },
      },
      {
        selector: 'node[?isEndpoint]',
        style: {
          'border-width': 5,
          'border-color': '#1e293b',
          'border-style': 'solid',
          'border-opacity': 0.85,
          width: 76,
          height: 76,
          'font-size': '10px',
          'font-weight': 700,
          'text-max-width': '42px',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'background-color': dark.value ? '#e2e8f0' : '#0f172a',
          color: dark.value ? '#0f172a' : '#ffffff',
          'text-outline-width': 0,
        },
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#a1a1aa', // --rf-edge
          'line-color': '#a1a1aa', // --rf-edge
          width: 1.5,
          'font-size': '7px',
          'font-family': 'DM Sans, system-ui, sans-serif',
          'font-style': 'italic',
          color: '#71717a', // --rf-edge-label
          'text-rotation': 'autorotate',
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.75,
          'text-background-padding': '1px',
          'text-background-shape': 'roundrectangle',
        },
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': '#0891b2', // --rf-primary
          'target-arrow-color': '#0891b2',
          width: 2.5,
        },
      },
      {
        selector: '.no-label',
        style: { label: '' },
      },
      {
        selector: '.dimmed',
        style: {
          opacity: 0.12,
          'transition-property': 'opacity',
          'transition-duration': 150,
          'transition-timing-function': 'ease-out',
        },
      },
    ],
    layout: { name: 'preset' },
    userPanningEnabled: true,
    boxSelectionEnabled: false,
  })

  runLayout()

  if (!showEdgeLabels.value) {
    cy.edges().addClass('no-label')
  }

  if (selectionMode.value === 'select') {
    cy.userPanningEnabled(false)
    cy.boxSelectionEnabled(true)
  }

  cy.on('select unselect', () => {
    const selected = cy!.elements(':selected')
    hasSelection.value = selected.length > 0
    if (selected.length > 0) {
      cy!.elements().addClass('no-label')
      selected.removeClass('no-label')
    } else {
      restoreLabels()
    }
  })

  // Node hover
  cy.on('mouseover', 'node', (evt) => {
    evt.target.addClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = 'pointer'
  })
  cy.on('mouseout', 'node', (evt) => {
    evt.target.removeClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = ''
  })

  // Node click → emit + neighbourhood highlight
  cy.on('tap', 'node', (evt) => {
    const nodeData = evt.target.data() as {
      id: string
      label: string
      iri: string
      class: string
      isEndpoint: boolean
    }
    const graphNode: GraphNode = {
      id: parseInt(nodeData.id.slice(1)), // strip the "n" prefix
      label: nodeData.label,
      iri: nodeData.iri,
      class: nodeData.class,
      isEndpoint: nodeData.isEndpoint,
    }
    emit('nodeClick', graphNode)

    // Dim everything outside the immediate neighbourhood (pan mode only)
    if (selectionMode.value === 'pan') {
      cy!.startBatch()
      cy!.elements().addClass('dimmed')
      evt.target.closedNeighborhood().removeClass('dimmed')
      cy!.endBatch()
    }
  })

  // Tap on background clears neighbourhood highlight
  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      cy!.startBatch()
      cy!.elements().removeClass('dimmed')
      cy!.endBatch()
    }
  })

  cy.on('zoom', () => {
    zoomLevel.value = Math.round(cy!.zoom() * 100)
  })

  hasGraph.value = true
}

function runLayout() {
  if (!cy) return
  layout?.stop()
  layout = cy.layout({
    name: 'd3-force',
    animate: !prefersReducedMotion(),
    // Required: tell forceLink to use the node's `id` field instead of
    // its array index (the plugin only sets this when linkId is defined).
    linkId: (d: { id: string }) => d.id,
    // Link spring — pulls connected nodes toward this distance
    linkDistance: 120,
    // Node repulsion — negative = push apart
    manyBodyStrength: -600,
    // Gentle pull toward canvas centre so the graph doesn't drift away
    gravity: 0.08,
    // Low damping = more bounce; 0.1 is very springy, 0.4 is D3 default
    velocityDecay: 0.15,
    // Nodes spring back into the simulation after being released
    fixedAfterDragging: false,
    padding: 40,
    fit: true,
    // Keep the simulation running indefinitely so the graph stays springy
    // and interactive after the initial layout settles — matching D3's behaviour.
    infinite: true,
  } as Parameters<Core['layout']>[0])
  layout.run()
}

function zoomIn() {
  cy?.zoom(cy.zoom() * 1.2)
}
function zoomOut() {
  cy?.zoom(cy.zoom() / 1.2)
}
function resetZoom() {
  if (!cy) return
  cy.zoom(1)
  cy.center()
}
function fitGraph() {
  cy?.fit(undefined, 40)
}
function rerunLayout() {
  runLayout()
}

function restoreLabels() {
  if (!cy) return
  cy.startBatch()
  cy.nodes().removeClass('no-label')
  if (showEdgeLabels.value) {
    cy.edges().removeClass('no-label')
  } else {
    cy.edges().addClass('no-label')
  }
  cy.elements().removeClass('dimmed')
  cy.endBatch()
}

function cropToSelection() {
  if (!cy) return
  const selected = cy.elements(':selected')
  if (selected.length === 0) return
  cropHistory.value.push(cy.elements().jsons() as cytoscape.ElementDefinition[])
  cy.startBatch()
  cy.elements().not(':selected').remove()
  cy.elements().unselect()
  cy.endBatch()
  hasSelection.value = false
  restoreLabels()
}

function undoCrop() {
  if (!cy || cropHistory.value.length === 0) return
  const snapshot = cropHistory.value.pop()!
  cy.startBatch()
  cy.elements().remove()
  cy.add(snapshot)
  cy.endBatch()
  hasSelection.value = false
  restoreLabels()
}

function toggleSelectionMode() {
  selectionMode.value = selectionMode.value === 'pan' ? 'select' : 'pan'
  if (!cy) return
  if (selectionMode.value === 'select') {
    cy.userPanningEnabled(false)
    cy.boxSelectionEnabled(true)
  } else {
    cy.userPanningEnabled(true)
    cy.boxSelectionEnabled(false)
    cy.elements().unselect()
    restoreLabels()
  }
}

function toggleEdgeLabels() {
  showEdgeLabels.value = !showEdgeLabels.value
  if (showEdgeLabels.value) {
    cy?.edges().removeClass('no-label')
  } else {
    cy?.edges().addClass('no-label')
  }
}

watch(dark, (isDark) => {
  if (!cy) return
  cy.style()
    .selector('node:selected')
    .style({
      'background-color': isDark ? '#e2e8f0' : '#0f172a',
      color: isDark ? '#0f172a' : '#ffffff',
    })
    .update()
})

// Re-render whenever the graph data changes
watch(
  () => [props.nodes, props.edges],
  () => {
    if (props.nodes.length > 0) {
      initCytoscape()
    } else {
      layout?.stop()
      layout = null
      cy?.destroy()
      cy = null
      hasGraph.value = false
    }
  },
  { deep: true },
)

onMounted(() => {
  if (props.nodes.length > 0) initCytoscape()

  if (cyContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      cy?.resize()
    })
    resizeObserver.observe(cyContainer.value)
    touchSelectEl = cyContainer.value
    attachTouchSelect(touchSelectEl)
  }
})

onUnmounted(() => {
  if (touchSelectEl) {
    detachTouchSelect(touchSelectEl)
    touchSelectEl = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  layout?.stop()
  layout = null
  cy?.destroy()
  cy = null
})

defineExpose({ PALETTE, zoomIn, zoomOut, fitGraph, rerunLayout, toggleEdgeLabels })
</script>

<style scoped>
.graph-canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--rf-bg);
}

.cy-container {
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  opacity: 1;
  transition: opacity var(--rf-duration-base) var(--rf-ease-out);
}

.cy-container.hidden {
  opacity: 0;
  pointer-events: none;
}


.select-mode-badge {
  position: absolute;
  top: var(--rf-space-4);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: 0.35rem 0.85rem;
  background: var(--rf-surface);
  border: 1px solid var(--rf-primary);
  border-radius: var(--rf-radius-full);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--rf-primary) 15%, transparent),
    var(--rf-shadow-md);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-primary);
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
}

.select-mode-badge .pi {
  font-size: 0.65rem;
}

.mode-badge-enter-active,
.mode-badge-leave-active {
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}
.mode-badge-enter-from,
.mode-badge-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>
