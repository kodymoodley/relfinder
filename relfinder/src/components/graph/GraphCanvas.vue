<template>
  <div class="graph-canvas-wrapper">
    <!-- Empty state -->
    <div v-if="!hasGraph && !loading" class="canvas-empty">
      <i class="pi pi-share-alt empty-icon" />
      <p>Select two entities and click <strong>Find Relationships</strong></p>
    </div>

    <!-- Loading overlay -->
    <div v-if="loading" class="canvas-loading">
      <ProgressSpinner stroke-width="3" />
      <p>Searching for paths…</p>
    </div>

    <!-- Cytoscape mount point — always in the DOM so cy can attach -->
    <div ref="cyContainer" class="cy-container" :class="{ hidden: !hasGraph }" />

    <!-- Toolbar (zoom controls) -->
    <div v-if="hasGraph" class="canvas-toolbar">
      <Button icon="pi pi-plus" text rounded size="small" @click="zoomIn" aria-label="Zoom in" />
      <Button icon="pi pi-minus" text rounded size="small" @click="zoomOut" aria-label="Zoom out" />
      <Button icon="pi pi-arrows-alt" text rounded size="small" @click="fitGraph" aria-label="Fit graph" />
      <Divider layout="vertical" />
      <Button icon="pi pi-refresh" text rounded size="small" @click="rerunLayout" aria-label="Re-run layout" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import cytoscape from 'cytoscape'
import type { Core, NodeSingular, Layouts } from 'cytoscape'
import d3Force from 'cytoscape-d3-force'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import ProgressSpinner from 'primevue/progressspinner'
import type { GraphNode, MergedEdge } from '@/lib/sparql/types'

cytoscape.use(d3Force as unknown as cytoscape.Ext)

// ── Props / emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  nodes: GraphNode[]
  edges: MergedEdge[]
  loading: boolean
  /** Map of rdf:type IRI → hex colour — passed from parent for consistent colouring */
  classColors: Map<string, string>
}>()

const emit = defineEmits<{
  nodeClick: [node: GraphNode]
}>()

// ── Cytoscape instance ────────────────────────────────────────────────────────

const cyContainer = ref<HTMLElement | null>(null)
let cy: Core | null = null
let layout: Layouts | null = null

const hasGraph = ref(false)

// Colour palette for node classes
const PALETTE = [
  '#4f8ef7', '#f76b4f', '#4fc994', '#f7c94f',
  '#a44ff7', '#4ff7f0', '#f74fa4', '#8ef74f',
]

function classColor(classIri: string): string {
  return props.classColors.get(classIri) ?? '#94a3b8'
}

// ── Graph rendering ───────────────────────────────────────────────────────────

// Prefix node IDs with "n" so they are unambiguously strings. Purely numeric
// IDs like "2" can be coerced to the number 2 inside cytoscape-d3-force's D3
// forceLink lookup, causing a Map key mismatch and a "node not found" error.
function nodeId(id: number) { return `n${id}` }

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

  cy = cytoscape({
    container: cyContainer.value,
    elements: buildElements(),
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': (ele: NodeSingular) => classColor(ele.data('class') as string),
          color: '#fff',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '11px',
          'text-wrap': 'wrap',
          'text-max-width': '80px',
          width: 60,
          height: 60,
          'border-width': 0,
          'text-outline-width': 1,
          'text-outline-color': 'rgba(0,0,0,0.35)',
        },
      },
      {
        selector: 'node[?isEndpoint]',
        style: {
          'border-width': 3,
          'border-color': '#fff',
          width: 72,
          height: 72,
          'font-size': '12px',
          'font-weight': 'bold',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#fff',
          'border-opacity': 1,
          'overlay-color': '#000',
          'overlay-opacity': 0.1,
        },
      },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#94a3b8',
          'line-color': '#94a3b8',
          width: 1.5,
          'font-size': '9px',
          color: '#64748b',
          'text-rotation': 'autorotate',
          'text-background-color': '#fff',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
        },
      },
      {
        selector: 'edge:selected',
        style: {
          'line-color': '#4f8ef7',
          'target-arrow-color': '#4f8ef7',
          width: 2.5,
        },
      },
    ],
    layout: { name: 'preset' },
  })

  runLayout()

  // Node click → emit event to parent
  cy.on('tap', 'node', (evt) => {
    const nodeData = evt.target.data() as {
      id: string; label: string; iri: string; class: string; isEndpoint: boolean
    }
    const graphNode: GraphNode = {
      id: parseInt(nodeData.id.slice(1)), // strip the "n" prefix
      label: nodeData.label,
      iri: nodeData.iri,
      class: nodeData.class,
      isEndpoint: nodeData.isEndpoint,
    }
    emit('nodeClick', graphNode)
  })

  hasGraph.value = true
}

function runLayout() {
  if (!cy) return
  layout?.stop()
  layout = cy.layout({
    name: 'd3-force',
    animate: true,
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

function zoomIn() { cy?.zoom(cy.zoom() * 1.2) }
function zoomOut() { cy?.zoom(cy.zoom() / 1.2) }
function fitGraph() { cy?.fit(undefined, 40) }
function rerunLayout() { runLayout() }

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
})

onUnmounted(() => {
  layout?.stop()
  layout = null
  cy?.destroy()
  cy = null
})

// Expose palette so parent can assign colours consistently
defineExpose({ PALETTE })
</script>

<style scoped>
.graph-canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--p-surface-ground);
}

.cy-container {
  width: 100%;
  height: 100%;
}

.cy-container.hidden {
  visibility: hidden;
  pointer-events: none;
}

.canvas-empty,
.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
  padding: 2rem;
  pointer-events: none;
}

.empty-icon {
  font-size: 3rem;
  opacity: 0.3;
}

.canvas-empty p {
  margin: 0;
  font-size: 0.95rem;
  max-width: 240px;
  line-height: 1.6;
}

.canvas-loading p {
  margin: 0;
  font-size: 0.9rem;
}

.canvas-toolbar {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 0.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
