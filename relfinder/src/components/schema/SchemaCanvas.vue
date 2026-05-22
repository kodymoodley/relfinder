<template>
  <div class="schema-canvas-wrapper">
    <!-- Empty state -->
    <div v-if="props.nodes.length === 0" class="canvas-empty" data-testid="schema-canvas-empty">
      <div class="empty-icon-wrap">
        <i :class="['pi', props.extracting ? 'pi-spinner pi-spin' : 'pi-sitemap', 'empty-icon']" />
      </div>
      <p class="empty-title">{{ props.extracting ? 'Extracting schema…' : 'No schema loaded' }}</p>
      <p class="empty-hint">
        <template v-if="props.extracting"> Discovering classes and relationships </template>
        <template v-else>
          Connect to a SPARQL endpoint and click <strong>Extract Schema</strong>
        </template>
      </p>
    </div>

    <!-- Cytoscape mount point — always in DOM so cy can attach -->
    <div
      ref="cyContainer"
      class="cy-container"
      :class="{ hidden: props.nodes.length === 0 }"
      data-testid="schema-canvas"
    />

    <!-- Hover tooltip -->
    <div
      v-if="tooltipContent"
      class="cy-tooltip"
      :class="{ 'cy-tooltip--visible': tooltipVisible }"
      :style="tooltipStyle"
    >
      <template v-if="tooltipContent.type === 'node'">
        <div class="tt-iri">{{ tooltipContent.iri }}</div>

        <div v-if="tooltipContent.outgoing.length" class="tt-section">
          <div class="tt-section-head">Object Properties</div>
          <div
            v-for="p in tooltipContent.outgoing.slice(0, 3)"
            :key="p.propIri + p.rangeIri"
            class="tt-prop-row"
          >
            <span class="tt-row-top">
              <span class="tt-label">{{ p.propLabel }}</span>
              <span class="tt-arrow">→</span>
              <span class="tt-range">{{ p.rangeLabel }}</span>
              <span class="tt-count">×{{ p.count }}</span>
            </span>
            <div class="tt-full-iri">{{ p.propIri }}</div>
          </div>
          <div v-if="tooltipContent.outgoing.length > 3" class="tt-more">
            +{{ tooltipContent.outgoing.length - 3 }} more — click to open
          </div>
        </div>

        <div v-if="tooltipContent.incoming.length" class="tt-section">
          <div class="tt-section-head">Incoming</div>
          <div
            v-for="c in tooltipContent.incoming.slice(0, 3)"
            :key="c.sourceIri + c.propIri"
            class="tt-prop-row"
          >
            <span class="tt-row-top">
              <span class="tt-range">{{ c.sourceLabel }}</span>
              <span class="tt-arrow">via</span>
              <span class="tt-label">{{ c.propLabel }}</span>
            </span>
            <div class="tt-full-iri">{{ c.propIri }}</div>
          </div>
          <div v-if="tooltipContent.incoming.length > 3" class="tt-more">
            +{{ tooltipContent.incoming.length - 3 }} more — click to open
          </div>
        </div>

        <div class="tt-section">
          <div class="tt-section-head">Data Properties</div>
          <div v-if="tooltipContent.dataPropsLoading" class="tt-loading">Loading…</div>
          <div v-else-if="tooltipContent.dataProps.length === 0" class="tt-loading">None found</div>
          <div
            v-else
            v-for="dp in tooltipContent.dataProps.slice(0, 3)"
            :key="dp.iri"
            class="tt-prop-row"
          >
            <span class="tt-row-top">
              <span class="tt-label">{{ dp.label }}</span>
              <span v-if="dp.datatypes.length" class="tt-datatypes">{{
                dp.datatypes.join(' · ')
              }}</span>
            </span>
            <div class="tt-full-iri">{{ dp.iri }}</div>
          </div>
          <div v-if="tooltipContent.dataProps.length > 3" class="tt-more">
            +{{ tooltipContent.dataProps.length - 3 }} more — click to open
          </div>
        </div>
      </template>

      <template v-else-if="tooltipContent.type === 'edge'">
        <div class="tt-edge-header">
          <span class="tt-range">{{ tooltipContent.sourceLabel }}</span>
          <span class="tt-arrow">→</span>
          <span class="tt-range">{{ tooltipContent.targetLabel }}</span>
        </div>
        <div class="tt-section">
          <div class="tt-section-head">Properties ({{ tooltipContent.edgeProps.length }})</div>
          <div v-for="p in tooltipContent.edgeProps" :key="p.iri" class="tt-prop-row">
            <span class="tt-row-top">
              <span class="tt-label">{{ p.label }}</span>
              <span class="tt-count">×{{ p.count }}</span>
            </span>
            <div class="tt-full-iri">{{ p.iri }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- Toolbar -->
    <div v-if="props.nodes.length > 0" class="canvas-toolbar" data-testid="schema-toolbar">
      <Button
        v-tooltip.top="'Zoom in'"
        icon="pi pi-plus"
        text
        rounded
        size="small"
        aria-label="Zoom in"
        data-testid="zoom-in-btn"
        @click="zoomIn"
      />
      <Button
        v-tooltip.top="'Zoom out'"
        icon="pi pi-minus"
        text
        rounded
        size="small"
        aria-label="Zoom out"
        data-testid="zoom-out-btn"
        @click="zoomOut"
      />
      <Button
        v-tooltip.top="'Fit to screen'"
        icon="pi pi-arrows-alt"
        text
        rounded
        size="small"
        aria-label="Fit"
        data-testid="fit-btn"
        @click="fitGraph"
      />
      <Divider layout="vertical" />
      <Button
        v-tooltip.top="'Re-run layout'"
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        aria-label="Re-run layout"
        data-testid="rerun-layout-btn"
        @click="rerunLayout"
      />
      <Divider layout="vertical" />
      <Button
        v-tooltip.top="showEdgeLabels ? 'Hide property labels' : 'Show property labels'"
        :icon="showEdgeLabels ? 'pi pi-eye' : 'pi pi-eye-slash'"
        text
        rounded
        size="small"
        :style="{ opacity: showEdgeLabels ? 1 : 0.45 }"
        :aria-label="showEdgeLabels ? 'Hide labels' : 'Show labels'"
        data-testid="toggle-labels-btn"
        @click="toggleEdgeLabels"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import cytoscape from 'cytoscape'
import type { Core, Layouts } from 'cytoscape'
import d3Force from 'cytoscape-d3-force'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import { useSchemaStore } from '@/stores/schema'
import { useConnectionStore } from '@/stores/connection'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'

cytoscape.use(d3Force as unknown as cytoscape.Ext)

// ── Props / emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  nodes: SchemaNode[]
  edges: SchemaEdge[]
  extracting?: boolean
}>()

const emit = defineEmits<{
  nodeClick: [node: SchemaNode]
  edgeClick: [edge: SchemaEdge]
}>()

const schemaStore = useSchemaStore()
const connectionStore = useConnectionStore()

// ── Cytoscape state ───────────────────────────────────────────────────────────

const cyContainer = ref<HTMLElement | null>(null)
let cy: Core | null = null
let layout: Layouts | null = null
let renderedNodeCount = 0
let renderedEdgeCount = 0
// IRI of the last node that was actually rendered — used to detect whether
// a nodes-length increase is a pure append (loadMore) or a filter change
// (orphan unhide). A pure append leaves all previously-rendered nodes in
// place, so props.nodes[renderedNodeCount-1] still matches this value.
let lastRenderedNodeIri = ''

const showEdgeLabels = ref(false)

// ── Tooltip state ─────────────────────────────────────────────────────────────

const hoveredNodeIri = ref<string | null>(null)
const hoveredEdge = ref<{ sourceIri: string; targetIri: string } | null>(null)
const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)

// ── Precomputed lookup maps (recomputed as edges arrive) ──────────────────────

const nodeLabelMap = computed(() => {
  const m = new Map<string, string>()
  for (const n of props.nodes) m.set(n.iri, n.label)
  return m
})

function nodeLabel(iri: string): string {
  return nodeLabelMap.value.get(iri) ?? iri.split(/[#/]/).pop() ?? iri
}

const outgoingByNode = computed(() => {
  const m = new Map<
    string,
    Array<{
      propIri: string
      propLabel: string
      rangeIri: string
      rangeLabel: string
      count: number
    }>
  >()
  for (const edge of props.edges) {
    const items = edge.props.map((p) => ({
      propIri: p.iri,
      propLabel: p.label,
      rangeIri: edge.targetIri,
      rangeLabel: nodeLabel(edge.targetIri),
      count: p.count,
    }))
    const existing = m.get(edge.sourceIri)
    if (existing) existing.push(...items)
    else m.set(edge.sourceIri, [...items])
  }
  return m
})

const incomingByNode = computed(() => {
  const m = new Map<
    string,
    Array<{ sourceIri: string; sourceLabel: string; propIri: string; propLabel: string }>
  >()
  for (const edge of props.edges) {
    const items = edge.props.map((p) => ({
      sourceIri: edge.sourceIri,
      sourceLabel: nodeLabel(edge.sourceIri),
      propIri: p.iri,
      propLabel: p.label,
    }))
    const existing = m.get(edge.targetIri)
    if (existing) existing.push(...items)
    else m.set(edge.targetIri, [...items])
  }
  return m
})

// Reactive: auto-updates when dataPropsCache / dataPropsLoading change
const tooltipContent = computed(() => {
  if (!tooltipVisible.value) return null

  if (hoveredNodeIri.value) {
    const iri = hoveredNodeIri.value
    return {
      type: 'node' as const,
      iri,
      outgoing: outgoingByNode.value.get(iri) ?? [],
      incoming: incomingByNode.value.get(iri) ?? [],
      dataProps: schemaStore.dataPropsCache.get(iri) ?? [],
      dataPropsLoading: schemaStore.dataPropsLoading.has(iri),
    }
  }

  if (hoveredEdge.value) {
    const { sourceIri, targetIri } = hoveredEdge.value
    const edge = props.edges.find((e) => e.sourceIri === sourceIri && e.targetIri === targetIri)
    if (!edge) return null
    return {
      type: 'edge' as const,
      sourceLabel: nodeLabel(sourceIri),
      targetLabel: nodeLabel(targetIri),
      edgeProps: edge.props,
    }
  }

  return null
})

// Flip tooltip left when near the right edge of the canvas
const tooltipStyle = computed(() => {
  const w = cyContainer.value?.offsetWidth ?? 800
  const flipLeft = tooltipX.value > w - 390
  return flipLeft
    ? { top: `${tooltipY.value}px`, right: `${w - tooltipX.value + 14}px`, left: 'auto' }
    : { top: `${tooltipY.value}px`, left: `${tooltipX.value}px`, right: 'auto' }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const NODE_COLOR = '#0891b2'

function edgeWidth(totalCount: number): number {
  return Math.min(1.5 + Math.log2(totalCount + 1), 5)
}

// ── Cytoscape init ────────────────────────────────────────────────────────────

function initCytoscape() {
  if (!cyContainer.value) return
  layout?.stop()
  cy?.destroy()
  renderedNodeCount = 0
  renderedEdgeCount = 0
  hoveredNodeIri.value = null
  hoveredEdge.value = null
  tooltipVisible.value = false

  lastRenderedNodeIri = ''

  cy = cytoscape({
    container: cyContainer.value,
    elements: [],
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': NODE_COLOR,
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
          'border-color': '#ffffff',
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

  if (import.meta.env.DEV) {
    ;(window as Window & { __schemaCy?: Core }).__schemaCy = cy
  }

  addNewNodes()
  runLayout()
  attachHandlers()
}

// ── Incremental node addition ─────────────────────────────────────────────────

function addNewNodes() {
  if (!cy) return
  const newNodes = props.nodes.slice(renderedNodeCount)
  if (newNodes.length === 0) return
  cy.add(newNodes.map((n) => ({ data: { id: n.iri, label: n.label, iri: n.iri } })))
  renderedNodeCount = props.nodes.length
  lastRenderedNodeIri = props.nodes[renderedNodeCount - 1]?.iri ?? ''
  addNewEdges()
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

  cy.on('mousemove', (e) => {
    const rp = e.renderedPosition
    tooltipX.value = rp.x + 16
    tooltipY.value = rp.y + 16
  })

  cy.on('mouseover', 'node', (e) => {
    e.target.addClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = 'pointer'
    const { iri } = e.target.data() as { iri: string }
    hoveredNodeIri.value = iri
    hoveredEdge.value = null
    tooltipVisible.value = true
    // Trigger background data-prop fetch if not yet cached
    if (!schemaStore.dataPropsCache.has(iri) && !schemaStore.dataPropsLoading.has(iri)) {
      const context = connectionStore.queryContext ?? { endpointUrl: '' }
      const store = connectionStore.rdfStore ?? undefined
      schemaStore.fetchDataProps(iri, context, store).catch(() => {})
    }
  })

  cy.on('mouseout', 'node', (e) => {
    e.target.removeClass('hovered')
    if (cyContainer.value) cyContainer.value.style.cursor = ''
    hoveredNodeIri.value = null
    tooltipVisible.value = false
  })

  cy.on('mouseover', 'edge', (e) => {
    if (cyContainer.value) cyContainer.value.style.cursor = 'pointer'
    const { sourceIri, targetIri } = e.target.data() as { sourceIri: string; targetIri: string }
    hoveredEdge.value = { sourceIri, targetIri }
    hoveredNodeIri.value = null
    tooltipVisible.value = true
  })

  cy.on('mouseout', 'edge', () => {
    if (cyContainer.value) cyContainer.value.style.cursor = ''
    hoveredEdge.value = null
    tooltipVisible.value = false
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
    infinite: true,
  } as Parameters<Core['layout']>[0])
  layout.run()
  // Fit once after nodes have spread out; subsequent zoom/pan is user-controlled
  setTimeout(() => cy?.fit(undefined, 40), 800)
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

function zoomIn() {
  cy?.zoom(cy.zoom() * 1.2)
}
function zoomOut() {
  cy?.zoom(cy.zoom() / 1.2)
}
function fitGraph() {
  cy?.fit(undefined, 40)
}
function rerunLayout() {
  runLayout()
}

function toggleEdgeLabels() {
  showEdgeLabels.value = !showEdgeLabels.value
  if (showEdgeLabels.value) cy?.edges().removeClass('no-label')
  else cy?.edges().addClass('no-label')
}

// ── Reactive updates ──────────────────────────────────────────────────────────

watch(
  () => props.nodes.length,
  (n, prev) => {
    if (n === 0) {
      layout?.stop()
      cy?.destroy()
      cy = null
      renderedNodeCount = 0
      renderedEdgeCount = 0
    } else if (!cy || prev === 0) {
      initCytoscape()
    } else if (
      n > renderedNodeCount &&
      props.nodes[renderedNodeCount - 1]?.iri === lastRenderedNodeIri
    ) {
      // Pure append (loadMore) — first renderedNodeCount nodes are unchanged
      addNewNodes()
    } else {
      // Filter changed (hide/show orphans, or orphan sorted before rendered nodes)
      initCytoscape()
    }
  },
)

// New edges arrived — add incrementally without restarting layout
watch(
  () => props.edges.length,
  () => {
    if (cy) addNewEdges()
  },
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

/* ── Hover tooltip ──────────────────────────────────────────────────────────── */

.cy-tooltip {
  position: absolute;
  z-index: 200;
  pointer-events: none;
  user-select: none;
  background: rgba(15, 23, 42, 0.96);
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 10px;
  max-width: 370px;
  max-height: 340px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 80ms ease;
}

.cy-tooltip--visible {
  opacity: 1;
}

.tt-iri {
  font-family: var(--rf-font-mono, 'Courier New', monospace);
  font-size: 10px;
  color: #94a3b8;
  word-break: break-all;
  margin-bottom: 4px;
}

.tt-edge-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  font-weight: 600;
}

.tt-section {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.tt-section-head {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #475569;
  margin-bottom: 5px;
}

.tt-prop-row {
  margin-bottom: 5px;
}

.tt-row-top {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
}

.tt-label {
  color: #e2e8f0;
  font-weight: 500;
}

.tt-count {
  color: #64748b;
  font-size: 10px;
  margin-left: 2px;
}

.tt-arrow {
  color: #475569;
  font-size: 10px;
}

.tt-range {
  color: #93c5fd;
}

.tt-full-iri {
  font-family: var(--rf-font-mono, 'Courier New', monospace);
  font-size: 9px;
  color: #475569;
  word-break: break-all;
  margin-top: 1px;
  padding-left: 2px;
}

.tt-datatypes {
  font-size: 10px;
  color: #86efac;
  margin-left: 3px;
}

.tt-more {
  font-size: 10px;
  color: #475569;
  font-style: italic;
  margin-top: 2px;
}

.tt-loading {
  font-size: 10px;
  color: #475569;
  font-style: italic;
}

/* ── Empty state ────────────────────────────────────────────────────────────── */

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
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.75);
    opacity: 0;
  }
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

/* ── Toolbar ────────────────────────────────────────────────────────────────── */

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
