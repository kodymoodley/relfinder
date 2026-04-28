<template>
  <div class="pair-panel">

    <!-- ── Mode toggle ──────────────────────────────────────────────────── -->
    <div class="panel-modes">
      <button
        class="panel-mode-btn"
        :class="{ 'panel-mode-btn--active': panelMode === 'class' }"
        @click="panelMode = 'class'"
      >
        <i class="pi pi-objects-column" />
        Class Pairs
      </button>
      <button
        class="panel-mode-btn"
        :class="{ 'panel-mode-btn--active': panelMode === 'instance' }"
        @click="panelMode = 'instance'"
      >
        <i class="pi pi-user" />
        Entity Pairs
      </button>
    </div>

    <!-- ── Entity Pairs mode ────────────────────────────────────────────── -->
    <InstancePairSection v-if="panelMode === 'instance'" />

    <!-- ── Class Pairs mode ─────────────────────────────────────────────── -->
    <template v-else>

    <!-- ── Class selectors ───────────────────────────────────────────────── -->
    <div class="selectors">
      <div class="selector-wrap">
        <label class="selector-label">Class A</label>
        <Select
          inputId="pair-c1"
          v-model="c1"
          :options="classOptions"
          option-label="label"
          option-value="value"
          placeholder="Pick a class…"
          :loading="classesLoading"
          filter
          filter-placeholder="Search classes…"
          :filter-input-props="{ id: 'pair-c1-filter', 'aria-label': 'Search Class A' }"
          size="small"
          fluid
          @change="onSelectionChange"
        />
      </div>

      <button class="swap-btn" :disabled="!c1 && !c2" aria-label="Swap classes" @click="swap">
        <i class="pi pi-arrows-h" />
      </button>

      <div class="selector-wrap">
        <label class="selector-label">Class B</label>
        <Select
          inputId="pair-c2"
          v-model="c2"
          :options="classOptions"
          option-label="label"
          option-value="value"
          placeholder="Pick a class…"
          :loading="classesLoading"
          filter
          filter-placeholder="Search classes…"
          :filter-input-props="{ id: 'pair-c2-filter', 'aria-label': 'Search Class B' }"
          size="small"
          fluid
          @change="onSelectionChange"
        />
      </div>
    </div>

    <!-- ── Find button ───────────────────────────────────────────────────── -->
    <div class="find-row">
      <Button
        :label="discovering ? 'Searching…' : 'Find Examples'"
        :icon="discovering ? 'pi pi-spin pi-spinner' : 'pi pi-search'"
        size="small"
        :disabled="!c1 || !c2 || discovering"
        fluid
        @click="startDiscovery"
      />
    </div>

    <!-- ── Results area ──────────────────────────────────────────────────── -->
    <div v-if="pairs.length > 0 || (allDone && hasSearched)" class="results">

      <!-- In-flight indicator shown while workers are still running -->
      <div v-if="discovering" class="discovery-status">
        <i class="pi pi-spin pi-spinner status-icon" />
        <span>Strategies running in parallel…</span>
      </div>

      <!-- Pair cards — animate in as each one arrives -->
      <TransitionGroup name="pair-slide" tag="ul" class="pair-list">
        <li v-for="pair in pairs" :key="pairKey(pair)" class="pair-card">

          <div class="pair-entities">
            <div class="pair-entity">
              <span class="entity-dot" style="background: #f97316" />
              <div class="entity-info">
                <span class="entity-label" :title="pair.entity1.iri">{{ pair.entity1.label }}</span>
                <span class="entity-class">{{ shortIri(c1 ?? '') }}</span>
              </div>
            </div>
            <i class="pi pi-arrows-h pair-arrow" />
            <div class="pair-entity pair-entity--right">
              <div class="entity-info entity-info--right">
                <span class="entity-label" :title="pair.entity2.iri">{{ pair.entity2.label }}</span>
                <span class="entity-class">{{ shortIri(c2 ?? '') }}</span>
              </div>
              <span class="entity-dot" style="background: #8b5cf6" />
            </div>
          </div>

          <div class="pair-path">
            <code class="path-sketch">{{ pair.pathSketch }}</code>
            <span class="path-badge">{{ pair.distance }} hop{{ pair.distance !== 1 ? 's' : '' }}</span>
          </div>

          <button class="explore-btn" @click="onExplore(pair)">
            <span>Explore relationship</span>
            <i class="pi pi-arrow-right" />
          </button>

        </li>
      </TransitionGroup>

      <!-- No results after all strategies finished -->
      <div v-if="allDone && pairs.length === 0" class="feedback-state">
        <i class="pi pi-info-circle feedback-icon" />
        <p class="feedback-text">No connections found within the configured max path length.</p>
      </div>

      <!-- ── Large-graph type-constraint panel ───────────────────────── -->
      <div
        v-if="allDone && isLargeGraph && !forceFullAlgorithm && (suggestedTypes.length > 0 || constraintTypesLoading)"
        class="constraint-panel"
      >
        <div class="constraint-header">
          <i class="pi pi-bolt constraint-icon" />
          <span class="constraint-title">Speed up next search</span>
        </div>
        <p class="constraint-desc">
          These node types were found on connecting paths. Restricting to them will
          significantly reduce search time. Deselect any you don't need.
        </p>

        <div v-if="constraintTypesLoading" class="constraint-loading">
          <i class="pi pi-spin pi-spinner" /> Analysing paths…
        </div>
        <div v-else class="constraint-types">
          <button
            v-for="t in suggestedTypes"
            :key="t.iri"
            class="type-chip"
            :class="{ 'type-chip--active': activeConstraintTypes.includes(t.iri) }"
            :title="t.iri"
            @click="toggleConstraintType(t.iri)"
          >
            {{ t.label }}
            <span class="type-chip-count">{{ t.count }}</span>
          </button>
        </div>

        <button
          class="refine-btn"
          :disabled="activeConstraintTypes.length === 0 || discovering"
          @click="findNew"
        >
          <i class="pi pi-search" />
          Search with selected types
        </button>

        <button class="full-algo-link" @click="forceFullAlgorithm = true">
          Use full algorithm instead
        </button>
      </div>

      <!-- ── Full-algorithm warning (large graph) ─────────────────────── -->
      <div v-if="isLargeGraph && forceFullAlgorithm" class="full-algo-warning">
        <i class="pi pi-exclamation-triangle warning-icon" />
        <div class="warning-body">
          <strong>Full algorithm active</strong>
          <span>
            This graph has more than 10,000 nodes. The unconstrained path search may be very
            slow or time out on large public endpoints.
          </span>
        </div>
        <button class="warning-dismiss" @click="forceFullAlgorithm = false">
          <i class="pi pi-times" />
        </button>
      </div>

      <!-- Find new examples once all strategies are done -->
      <div v-if="allDone && pairs.length > 0" class="find-new-row">
        <button class="find-new-btn" @click="findNew">
          <i class="pi pi-refresh" />
          Find different examples
        </button>
      </div>
    </div>

    <!-- ── Empty / initial state ─────────────────────────────────────────── -->
    <div v-else-if="!discovering" class="empty-state">
      <i class="pi pi-share-alt empty-icon" />
      <p class="empty-text">
        Pick two classes to discover example entity pairs that are connected within the graph.
      </p>
    </div>

    </template><!-- end class-pairs mode -->

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useConnectionStore } from '@/stores/connection'
import {
  fetchClassesWithCounts,
  findRelationships,
  estimateGraphNodeCount,
  fetchIntermediateTypesForPairs,
} from '@/lib/sparql/entitySearch'
import InstancePairSection from './InstancePairSection.vue'
import { discoverClassPairs } from '@/lib/sparql/classPairDiscovery'
import { cacheSet, cacheGet } from '@/lib/cache/queryCache'
import { shortIri } from '@/lib/utils/iri'
import type { ClassInfo, DiscoveredPair } from '@/lib/sparql/types'
import { QueryCyclesStrategy } from '@/lib/sparql/types'

const router = useRouter()
const connectionStore = useConnectionStore()

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_KEY = 'classpairs:ui-session'

interface PairsSession {
  c1: string | null
  c2: string | null
  pairs: DiscoveredPair[]
  allDone: boolean
  hasSearched: boolean
  discoveryOffset: number
  suggestedTypes: Array<{ iri: string; label: string; count: number }>
  activeConstraintTypes: string[]
  forceFullAlgorithm: boolean
}

// ── Panel mode ────────────────────────────────────────────────────────────────

const panelMode = ref<'class' | 'instance'>('class')

// ── Class list ────────────────────────────────────────────────────────────────

const classes = ref<ClassInfo[]>([])
const classesLoading = ref(false)

const classOptions = computed(() =>
  classes.value.map((c) => ({
    label: c.count ? `${c.label} (${c.count.toLocaleString()})` : c.label,
    value: c.iri,
  })),
)

onMounted(async () => {
  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  if (!ctx && !store) return
  const effectiveCtx = ctx ?? { endpointUrl: '' }
  classesLoading.value = true
  // Run class loading and graph-size check in parallel
  const [fetchedClasses, nodeCount] = await Promise.allSettled([
    fetchClassesWithCounts(effectiveCtx, store),
    estimateGraphNodeCount(effectiveCtx, store),
  ])
  classesLoading.value = false
  if (fetchedClasses.status === 'fulfilled') classes.value = fetchedClasses.value
  isLargeGraph.value = nodeCount.status === 'fulfilled' ? nodeCount.value > 10_000 : false

  // Restore pair results from the previous visit so the user doesn't lose them
  const saved = cacheGet<PairsSession>(SESSION_KEY)
  if (saved?.hasSearched) {
    c1.value = saved.c1
    c2.value = saved.c2
    pairs.value = saved.pairs
    allDone.value = saved.allDone
    hasSearched.value = saved.hasSearched
    discoveryOffset.value = saved.discoveryOffset
    suggestedTypes.value = saved.suggestedTypes
    activeConstraintTypes.value = saved.activeConstraintTypes
    forceFullAlgorithm.value = saved.forceFullAlgorithm
  }
})

onUnmounted(() => {
  cancelDiscovery?.()
  cacheSet<PairsSession>(SESSION_KEY, {
    c1: c1.value,
    c2: c2.value,
    pairs: [...pairs.value],
    allDone: allDone.value,
    hasSearched: hasSearched.value,
    discoveryOffset: discoveryOffset.value,
    suggestedTypes: [...suggestedTypes.value],
    activeConstraintTypes: [...activeConstraintTypes.value],
    forceFullAlgorithm: forceFullAlgorithm.value,
  }, 30 * 60 * 1000)
})

// ── Selection ─────────────────────────────────────────────────────────────────

const c1 = ref<string | null>(null)
const c2 = ref<string | null>(null)

function swap() {
  ;[c1.value, c2.value] = [c2.value, c1.value]
}

function onSelectionChange() {
  cancelDiscovery?.()
  discovering.value = false
  pairs.value = []
  allDone.value = false
  hasSearched.value = false
  suggestedTypes.value = []
  activeConstraintTypes.value = []
}

// ── Graph size + path-type constraints ───────────────────────────────────────

const isLargeGraph = ref<boolean | null>(null)
const forceFullAlgorithm = ref(false)
const suggestedTypes = ref<Array<{ iri: string; label: string; count: number }>>([])
const activeConstraintTypes = ref<string[]>([])
const constraintTypesLoading = ref(false)

async function loadIntermediateTypes() {
  if (!pairs.value.length) return
  constraintTypesLoading.value = true
  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  const effectiveCtx = ctx ?? { endpointUrl: '' }
  suggestedTypes.value = await fetchIntermediateTypesForPairs(pairs.value, effectiveCtx, store)
  // Pre-select all discovered types
  activeConstraintTypes.value = suggestedTypes.value.map((t) => t.iri)
  constraintTypesLoading.value = false
}

function toggleConstraintType(iri: string) {
  const idx = activeConstraintTypes.value.indexOf(iri)
  if (idx === -1) activeConstraintTypes.value.push(iri)
  else activeConstraintTypes.value.splice(idx, 1)
}

// ── Discovery ─────────────────────────────────────────────────────────────────

const pairs = ref<DiscoveredPair[]>([])
const discovering = ref(false)
const allDone = ref(false)
const hasSearched = ref(false)
const discoveryOffset = ref(0)

let cancelDiscovery: (() => void) | null = null

function effectiveConstraintTypes(): string[] {
  if (!isLargeGraph.value || forceFullAlgorithm.value) return []
  return activeConstraintTypes.value
}

function startDiscovery() {
  if (!c1.value || !c2.value) return
  cancelDiscovery?.()
  pairs.value = []
  discovering.value = true
  allDone.value = false
  hasSearched.value = true
  suggestedTypes.value = []

  const constraintTypes = effectiveConstraintTypes()

  cancelDiscovery = discoverClassPairs(
    c1.value,
    c2.value,
    connectionStore.queryContext,
    connectionStore.rdfStore ?? undefined,
    {
      maxDistance: 3,
      pairLimit: 6,
      offset: discoveryOffset.value,
      allowedIntermediateTypes: constraintTypes,
    },
    (pair) => {
      pairs.value.push(pair)
      prewarmPair(pair)
    },
    () => {
      discovering.value = false
      allDone.value = true
      // After an unconstrained run on a large graph, infer intermediate types
      if (isLargeGraph.value && !forceFullAlgorithm.value && constraintTypes.length === 0) {
        loadIntermediateTypes()
      }
    },
  )
}

function findNew() {
  discoveryOffset.value++
  startDiscovery()
}

// ── Background pre-warming ────────────────────────────────────────────────────
//
// Called immediately when each pair is discovered so the cache is ready (or
// nearly ready) by the time the user clicks Explore.

async function prewarmPair(pair: DiscoveredPair) {
  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  const effectiveContext = ctx ?? { endpointUrl: '' }
  const cacheKey = `graph:${effectiveContext.endpointUrl}:${pair.entity1.iri}:${pair.entity2.iri}`
  try {
    const graph = await findRelationships(
      pair.entity1.iri,
      pair.entity2.iri,
      3,
      effectiveContext,
      { avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES, store },
    )
    cacheSet(cacheKey, graph, 30 * 60 * 1000)
  } catch {
    // Pre-warming is best-effort; ignore failures silently
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

function onExplore(pair: DiscoveredPair) {
  const ctx = connectionStore.queryContext
  const endpointUrl = ctx?.endpointUrl ?? ''
  const cacheKey = `graph:${endpointUrl}:${pair.entity1.iri}:${pair.entity2.iri}`

  router.push({
    name: 'graph',
    state: {
      example: JSON.parse(JSON.stringify({
        entity1: { iri: pair.entity1.iri, label: pair.entity1.label, class: c1.value ?? '' },
        entity2: { iri: pair.entity2.iri, label: pair.entity2.label, class: c2.value ?? '' },
        cacheKey,
      })),
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pairKey(pair: DiscoveredPair): string {
  return `${pair.entity1.iri}|${pair.entity2.iri}`
}
</script>

<style scoped>
.pair-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Panel mode toggle ───────────────────────────────────────────────────── */

.panel-modes {
  display: flex;
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
}

.panel-mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-2);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
  margin-bottom: -1px;
}

.panel-mode-btn:hover {
  color: var(--rf-text);
}

.panel-mode-btn--active {
  color: var(--rf-primary);
  border-bottom-color: var(--rf-primary);
}

/* ── Selectors ───────────────────────────────────────────────────────────── */

.selectors {
  display: flex;
  align-items: flex-end;
  gap: var(--rf-space-2);
  padding: var(--rf-space-4) var(--rf-space-4) 0;
  flex-shrink: 0;
}

.selector-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.selector-label {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
  display: block;
}

.swap-btn {
  background: none;
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  padding: var(--rf-space-2);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: var(--rf-text-sm);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
  /* Align with the Select inputs */
  margin-bottom: 1px;
}

.swap-btn:hover:not(:disabled) {
  color: var(--rf-primary);
  border-color: var(--rf-primary);
}

.swap-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Find row ────────────────────────────────────────────────────────────── */

.find-row {
  padding: var(--rf-space-3) var(--rf-space-4);
  flex-shrink: 0;
}

/* ── Discovery status ────────────────────────────────────────────────────── */

.discovery-status {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-4);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
}

.status-icon {
  font-size: var(--rf-text-xs);
  color: var(--rf-primary);
}

/* ── Results ─────────────────────────────────────────────────────────────── */

.results {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.pair-list {
  list-style: none;
  margin: 0;
  padding: var(--rf-space-2) var(--rf-space-4) var(--rf-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-3);
}

/* ── Pair card ───────────────────────────────────────────────────────────── */

.pair-card {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
  padding: var(--rf-space-3) var(--rf-space-4);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  transition: border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.pair-card:hover {
  border-color: var(--rf-border-strong);
}

.pair-entities {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.pair-entity {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.pair-entity--right {
  justify-content: flex-end;
}

.entity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.entity-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.entity-info--right {
  align-items: flex-end;
}

.entity-label {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-class {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pair-arrow {
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
  flex-shrink: 0;
}

/* ── Path sketch ─────────────────────────────────────────────────────────── */

.pair-path {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.path-sketch {
  font-family: var(--rf-font-mono);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.path-badge {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.45rem;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Explore button ──────────────────────────────────────────────────────── */

.explore-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-primary-soft);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 30%, transparent);
  border-radius: var(--rf-radius-sm);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-primary);
  cursor: pointer;
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out);
}

.explore-btn:hover {
  background: color-mix(in srgb, var(--rf-primary) 18%, transparent);
  border-color: color-mix(in srgb, var(--rf-primary) 50%, transparent);
}

/* ── Find new ────────────────────────────────────────────────────────────── */

.find-new-row {
  padding: var(--rf-space-2) var(--rf-space-4) var(--rf-space-4);
  display: flex;
  justify-content: center;
}

.find-new-btn {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  background: none;
  border: none;
  padding: var(--rf-space-2) var(--rf-space-3);
  cursor: pointer;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  border-radius: var(--rf-radius-sm);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.find-new-btn:hover {
  color: var(--rf-primary);
}

/* ── Feedback / empty states ─────────────────────────────────────────────── */

.feedback-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-3);
  flex: 1;
  padding: var(--rf-space-10) var(--rf-space-5);
  text-align: center;
}

.feedback-icon,
.empty-icon {
  font-size: 1.25rem;
  color: var(--rf-text-subtle);
}

.feedback-text,
.empty-text {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  line-height: var(--rf-leading-relaxed);
}

/* ── Constraint panel (large-graph type suggestion) ─────────────────────── */

.constraint-panel {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-3);
  margin: 0 var(--rf-space-4) var(--rf-space-2);
  padding: var(--rf-space-3) var(--rf-space-4);
  background: color-mix(in srgb, var(--rf-primary) 6%, var(--rf-surface));
  border: 1px solid color-mix(in srgb, var(--rf-primary) 25%, transparent);
  border-radius: var(--rf-radius-md);
}

.constraint-header {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.constraint-icon {
  font-size: var(--rf-text-sm);
  color: var(--rf-primary);
}

.constraint-title {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.constraint-desc {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

.constraint-loading {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
}

.constraint-types {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rf-space-2);
}

.type-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--rf-space-1);
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  background: var(--rf-surface);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  cursor: pointer;
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out);
}

.type-chip--active {
  background: var(--rf-primary-soft);
  border-color: color-mix(in srgb, var(--rf-primary) 40%, transparent);
  color: var(--rf-primary);
}

.type-chip-count {
  font-size: 0.65rem;
  opacity: 0.7;
}

.refine-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-primary);
  border: none;
  border-radius: var(--rf-radius-sm);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: #fff;
  cursor: pointer;
  transition: opacity var(--rf-duration-fast) var(--rf-ease-out);
}

.refine-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.refine-btn:not(:disabled):hover {
  opacity: 0.88;
}

.full-algo-link {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  align-self: flex-start;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.full-algo-link:hover {
  color: var(--rf-text);
}

/* ── Full-algorithm warning ───────────────────────────────────────────────── */

.full-algo-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--rf-space-3);
  margin: 0 var(--rf-space-4) var(--rf-space-2);
  padding: var(--rf-space-3) var(--rf-space-3);
  background: color-mix(in srgb, var(--rf-warning, #f59e0b) 10%, var(--rf-surface));
  border: 1px solid color-mix(in srgb, var(--rf-warning, #f59e0b) 40%, transparent);
  border-radius: var(--rf-radius-md);
}

.warning-icon {
  font-size: var(--rf-text-sm);
  color: var(--rf-warning, #f59e0b);
  flex-shrink: 0;
  margin-top: 1px;
}

.warning-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
  font-size: var(--rf-text-xs);
}

.warning-body strong {
  color: var(--rf-text);
  font-weight: var(--rf-weight-semibold);
}

.warning-body span {
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

.warning-dismiss {
  background: none;
  border: none;
  padding: var(--rf-space-1);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.65rem;
  flex-shrink: 0;
  border-radius: var(--rf-radius-sm);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.warning-dismiss:hover {
  color: var(--rf-text);
}

/* ── Transition ──────────────────────────────────────────────────────────── */

.pair-slide-enter-active {
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}

.pair-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
