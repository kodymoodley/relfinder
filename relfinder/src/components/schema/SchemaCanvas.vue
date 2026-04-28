<template>
  <div class="schema-canvas-wrapper">
    <!-- Empty state -->
    <div v-if="props.nodes.length === 0" class="canvas-empty">
      <div class="empty-icon-wrap">
        <i class="pi pi-sitemap empty-icon" />
      </div>
      <p class="empty-title">No schema loaded</p>
      <p class="empty-hint">
        Connect to a SPARQL endpoint and click <strong>Extract Schema</strong>
      </p>
    </div>

    <!-- Cytoscape mount point — always in DOM so cy can attach -->
    <div ref="cyContainer" class="cy-container" :class="{ hidden: props.nodes.length === 0 }" />

    <!-- Toolbar -->
    <div v-if="props.nodes.length > 0" class="canvas-toolbar">
      <Button v-tooltip.top="'Zoom in'" icon="pi pi-plus" text rounded size="small" aria-label="Zoom in" @click="zoomIn" />
      <Button v-tooltip.top="'Zoom out'" icon="pi pi-minus" text rounded size="small" aria-label="Zoom out" @click="zoomOut" />
      <Button v-tooltip.top="'Fit to screen'" icon="pi pi-arrows-alt" text rounded size="small" aria-label="Fit" @click="fitGraph" />
      <Divider layout="vertical" />
      <Button v-tooltip.top="'Re-run layout'" icon="pi pi-refresh" text rounded size="small" aria-label="Re-run layout" @click="rerunLayout" />
      <Divider layout="vertical" />
      <Button
        v-tooltip.top="showEdgeLabels ? 'Hide property labels' : 'Show property labels'"
        :icon="showEdgeLabels ? 'pi pi-eye' : 'pi pi-eye-slash'"
        text rounded size="small"
        :style="{ opacity: showEdgeLabels ? 1 : 0.45 }"
        :aria-label="showEdgeLabels ? 'Hide labels' : 'Show labels'"
        @click="toggleEdgeLabels"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import cytoscape from 'cytoscape'
import type { Core, Layouts } from 'cytoscape'
import d3Force from 'cytoscape-d3-force'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'

cytoscape.use(d3Force as unknown as cytoscape.Ext)

// ── Props / emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  nodes: SchemaNode[]
  edges: SchemaEdge[]
}>()

const emit = defineEmits<{
  nodeClick: [node: SchemaNode]
  edgeClick: [edge: SchemaEdge]
}>()

// ── Cytoscape state ───────────────────────────────────────────────────────────

const cyContainer = ref<HTMLElement | null>(null)
let cy: Core | null = null
let layout: Layouts | null = null
let renderedEdgeCount = 0

const showEdgeLabels = ref(false)

// ── Colour helpers ────────────────────────────────────────────────────────────

const PALETTE = [
  '#06b6d4', '#10b981', '#a78bfa', '#facc15',
  '#f472b6', '#f87171', '#60a5fa', '#a3e635',
  '#fb923c', '#34d399', '#818cf8', '#fbbf24',
]

function hashColor(iri: string): string {
  let h = 0
  for (const c of iri) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

function edgeWidth(totalCount: number): number {
  return Math.min(1.5 + Math.log2(totalCount + 1), 5)
}

// ── Cytoscape init ────────────────────────────────────────────────────────────

function initCytoscape() {
  if (!cyContainer.value) return
  layout?.stop()
  cy?.destroy()
  renderedEdgeCount = 0

  cy = cytoscape({
    container: cyContainer.value,
    elements: props.nodes.map((n) => ({
      data: { id: n.iri, label: n.label, iri: n.iri, color: hashColor(n.iri) },
    })),
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': 'data(color)',
          color: '#ffffff',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '9px',
          'font-family': 'Syne, DM Sans, system-ui, sans-serif',
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-max-width': '60px',
          width: 60,
          height: 60,
          'text-outline-width': 1.5,
          'text-outline-color': 'rgba(0,0,0,0.3)',
          'transition-property': 'width height border-width border-color',
          'transition-duration': 120,
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
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#0891b2',
          'border-style': 'solid',
        },
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#a1a1aa',
          'line-color': '#a1a1aa',
          width: 'data(width)',
          'font-size': '7px',
          'font-family': 'DM Sans, system-ui, sans-serif',
          'font-style': 'italic',
          color: '#71717a',
          'text-rotation': 'autorotate',
          'text-background-color': '#ffffff',
          'text-background-opacity': 0.75,
          'text-background-padding': '1px',
          'text-background-shape': 'roundrectangle',
        },
      },
      {
        selector: 'edge.no-label',
        style: { label: '' },
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': '#0891b2',
          'target-arrow-color': '#0891b2',
          width: 3,
        },
      },
    ],
    layout: { name: 'preset' },
    userPanningEnabled: true,
    boxSelectionEnabled: false,
  })

  addNewEdges()
  runLayout()
  attachHandlers()
}

// ── Incremental edge addition ─────────────────────────────────────────────────

function addNewEdges() {
  if (!cy) return
  const newEdges = props.edges.slice(renderedEdgeCount)
  if (newEdges.length === 0) return

  const els = newEdges
    .filter((e) => cy!.$id(e.sourceIri).length > 0 && cy!.$id(e.targetIri).length > 0)
    .map((e) => ({
      data: {
        id: `${e.sourceIri}__${e.targetIri}`,
        source: e.sourceIri,
        target: e.targetIri,
        label: e.props[0]?.label ?? '',
        width: edgeWidth(e.totalCount),
        sourceIri: e.sourceIri,
        targetIri: e.targetIri,
      },
    }))

  if (els.length > 0) {
    const added = cy.add(els)
    if (!showEdgeLabels.value) added.addClass('no-label')
  }

  renderedEdgeCount = props.edges.length
}

// ── Event handlers ────────────────────────────────────────────────────────────

function attachHandlers() {
  if (!cy) return

  cy.on('mouseover', 'node', (e) => {
    e.target.addClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = 'pointer'
  })
  cy.on('mouseout', 'node', (e) => {
    e.target.removeClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = ''
  })
  cy.on('mouseover', 'edge', () => {
    if (cyContainer.value) cyContainer.value.style.cursor = 'pointer'
  })
  cy.on('mouseout', 'edge', () => {
    if (cyContainer.value) cyContainer.value.style.cursor = ''
  })
  cy.on('tap', 'node', (e) => {
    const { iri, label } = e.target.data() as { iri: string; label: string }
    emit('nodeClick', { iri, label })
  })
  cy.on('tap', 'edge', (e) => {
    const { sourceIri, targetIri } = e.target.data() as { sourceIri: string; targetIri: string }
    const edge = props.edges.find((ed) => ed.sourceIri === sourceIri && ed.targetIri === targetIri)
    if (edge) emit('edgeClick', edge)
  })
}

// ── Layout ────────────────────────────────────────────────────────────────────

function runLayout() {
  if (!cy) return
  layout?.stop()
  layout = cy.layout({
    name: 'd3-force',
    animate: true,
    linkId: (d: { id: string }) => d.id,
    linkDistance: 150,
    manyBodyStrength: -800,
    gravity: 0.1,
    velocityDecay: 0.2,
    fixedAfterDragging: false,
    padding: 40,
    fit: true,
    infinite: true,
  } as Parameters<Core['layout']>[0])
  layout.run()
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

function zoomIn() { cy?.zoom(cy.zoom() * 1.2) }
function zoomOut() { cy?.zoom(cy.zoom() / 1.2) }
function fitGraph() { cy?.fit(undefined, 40) }
function rerunLayout() { runLayout() }

function toggleEdgeLabels() {
  showEdgeLabels.value = !showEdgeLabels.value
  if (showEdgeLabels.value) cy?.edges().removeClass('no-label')
  else cy?.edges().addClass('no-label')
}

// ── Reactive updates ──────────────────────────────────────────────────────────

// New extraction started — rebuild from scratch
watch(
  () => props.nodes.length,
  (n) => {
    if (n > 0) initCytoscape()
    else { layout?.stop(); cy?.destroy(); cy = null; renderedEdgeCount = 0 }
  },
)

// New edges arrived — add incrementally without restarting layout
watch(
  () => props.edges.length,
  () => { if (cy) addNewEdges() },
)

onMounted(() => { if (props.nodes.length > 0) initCytoscape() })

onUnmounted(() => { layout?.stop(); layout = null; cy?.destroy(); cy = null })
</script>

<style scoped>
.schema-canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--rf-bg);
}

.cy-container {
  width: 100%;
  height: 100%;
}

.cy-container.hidden {
  opacity: 0;
  pointer-events: none;
}

.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-4);
  color: var(--rf-text-muted);
  text-align: center;
  padding: var(--rf-space-8);
  pointer-events: none;
}

.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: var(--rf-radius-full);
  background: var(--rf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--rf-space-2);
  position: relative;
}

@keyframes icon-ring-pulse {
  0%   { transform: scale(1);    opacity: 0.6; }
  100% { transform: scale(1.75); opacity: 0; }
}

.empty-icon-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--rf-radius-full);
  border: 2px solid var(--rf-primary);
  animation: icon-ring-pulse 2s ease-out infinite;
}

.empty-icon {
  font-size: 2rem;
  color: var(--rf-primary);
  opacity: 0.7;
}

.empty-title {
  margin: 0;
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-md);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-text);
  letter-spacing: -0.01em;
}

.empty-hint {
  margin: 0;
  font-size: var(--rf-text-sm);
  max-width: 220px;
  line-height: var(--rf-leading-relaxed);
}

.empty-hint strong {
  color: var(--rf-text);
  font-weight: var(--rf-weight-semibold);
}

.canvas-toolbar {
  position: absolute;
  bottom: var(--rf-space-4);
  right: var(--rf-space-4);
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-lg);
  padding: var(--rf-space-1);
  box-shadow: var(--rf-shadow-md);
}
</style>
