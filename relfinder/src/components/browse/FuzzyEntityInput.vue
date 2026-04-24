<template>
  <div class="fei">
    <!-- Header: label + Browse/Type toggle -->
    <div class="fei-header">
      <span class="fei-label">{{ label }}</span>
      <div class="fei-modes" :aria-label="`${label} search mode`">
        <button
          class="fei-mode-btn"
          :class="{ 'fei-mode-btn--active': mode === 'browse' }"
          @click="setMode('browse')"
        >Browse</button>
        <button
          class="fei-mode-btn"
          :class="{ 'fei-mode-btn--active': mode === 'type' }"
          @click="setMode('type')"
        >Type</button>
      </div>
    </div>

    <!-- Browse mode: reuse EntitySearch as-is -->
    <EntitySearch
      v-if="mode === 'browse'"
      :id="`fei-${id}`"
      label=""
      placeholder="Search…"
      :dot-color="dotColor"
      @select="onBrowseSelect"
    />

    <!-- Type mode: free-text + fuzzy BM25 re-ranking -->
    <div v-else class="fei-type">
      <template v-if="!typeSelected">
        <div class="fei-input-wrap">
          <input
            :id="`fei-${id}-type`"
            :aria-label="`Search for ${label}`"
            v-model="typeQuery"
            class="fei-input"
            placeholder="Type to search…"
            autocomplete="off"
            @input="onTypeInput"
          />
          <i v-if="typeSearching" class="pi pi-spin pi-spinner fei-spinner" />
        </div>

        <ul v-if="typeResults.length > 0" class="fei-results">
          <li
            v-for="r in typeResults"
            :key="r.iri"
            class="fei-result"
            @click="onTypeSelect(r)"
          >
            <span class="fei-result-label">{{ r.label }}</span>
            <span class="fei-result-class">{{ shortIri(r.class) }}</span>
          </li>
        </ul>
        <p v-else-if="typeNoResults && !typeSearching" class="fei-hint">No matches found</p>
      </template>

      <!-- Chip once selected -->
      <div v-else class="fei-chip">
        <i class="pi pi-circle-fill fei-chip-dot" :style="{ color: dotColor }" />
        <span class="fei-chip-label" :title="typeSelected.iri">{{ typeSelected.label }}</span>
        <button class="fei-chip-remove" aria-label="Remove" @click="onTypeClear">
          <i class="pi pi-times" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MiniSearch from 'minisearch'
import EntitySearch from '@/components/graph/EntitySearch.vue'
import { useConnectionStore } from '@/stores/connection'
import { searchEntities } from '@/lib/sparql/entitySearch'
import type { EntitySearchResult } from '@/lib/sparql/types'
import { shortIri } from '@/lib/utils/iri'

const props = defineProps<{
  id: string
  label: string
  dotColor?: string
}>()

const emit = defineEmits<{
  select: [entity: EntitySearchResult | null]
}>()

const connectionStore = useConnectionStore()

// ── Mode toggle ───────────────────────────────────────────────────────────────

const mode = ref<'browse' | 'type'>('browse')

function setMode(m: 'browse' | 'type') {
  if (mode.value === m) return
  mode.value = m
  typeSelected.value = null
  typeQuery.value = ''
  typeResults.value = []
  typeNoResults.value = false
  emit('select', null)
}

// ── Browse mode ───────────────────────────────────────────────────────────────

function onBrowseSelect(entity: EntitySearchResult | null) {
  emit('select', entity)
}

// ── Type mode: BM25 fuzzy search ──────────────────────────────────────────────

const typeQuery = ref('')
const typeResults = ref<EntitySearchResult[]>([])
const typeSearching = ref(false)
const typeNoResults = ref(false)
const typeSelected = ref<EntitySearchResult | null>(null)
let typeDebounce: ReturnType<typeof setTimeout> | null = null

function onTypeInput() {
  if (typeDebounce) clearTimeout(typeDebounce)
  const q = typeQuery.value.trim()
  if (q.length < 2) {
    typeResults.value = []
    typeNoResults.value = false
    return
  }
  typeDebounce = setTimeout(() => runFuzzySearch(q), 350)
}

async function runFuzzySearch(query: string) {
  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  const effectiveCtx = ctx ?? { endpointUrl: '' }

  typeSearching.value = true
  typeNoResults.value = false
  typeResults.value = []

  try {
    // Primary SPARQL / Comunica search
    const primary = await searchEntities(effectiveCtx, [], store, 50, query, '', [])

    // For multi-word queries with few hits, also try each word separately so
    // the re-ranker has more candidates to surface typo-tolerant matches from.
    const candidates: EntitySearchResult[] = [...primary]
    if (primary.length < 8) {
      const words = query.split(/\s+/).filter((w) => w.length > 2)
      if (words.length > 1) {
        for (const word of words) {
          const sub = await searchEntities(effectiveCtx, [], store, 20, word, '', [])
          for (const r of sub) {
            if (!candidates.some((c) => c.iri === r.iri)) candidates.push(r)
          }
        }
      }
    }

    if (candidates.length === 0) {
      typeNoResults.value = true
      return
    }

    // Re-rank with MiniSearch BM25 + edit-distance fuzzy
    const ms = new MiniSearch<{ id: number; label: string }>({
      fields: ['label'],
      storeFields: ['label'],
    })
    ms.addAll(candidates.map((c, i) => ({ id: i, label: c.label })))
    const hits = ms.search(query, { fuzzy: 0.25, prefix: true })

    const ranked: EntitySearchResult[] = []
    const seen = new Set<number>()
    for (const h of hits) {
      const idx = h.id as number
      if (!seen.has(idx)) {
        seen.add(idx)
        ranked.push(candidates[idx])
      }
    }
    // Append any SPARQL candidates that didn't appear in MiniSearch hits
    for (let i = 0; i < candidates.length; i++) {
      if (!seen.has(i)) ranked.push(candidates[i])
    }

    typeResults.value = ranked.slice(0, 15)
    typeNoResults.value = ranked.length === 0
  } catch {
    typeNoResults.value = true
  } finally {
    typeSearching.value = false
  }
}

function onTypeSelect(entity: EntitySearchResult) {
  typeSelected.value = entity
  typeResults.value = []
  emit('select', entity)
}

function onTypeClear() {
  typeSelected.value = null
  typeQuery.value = ''
  typeResults.value = []
  typeNoResults.value = false
  emit('select', null)
}
</script>

<style scoped>
.fei {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

/* ── Header ───────────────────────────────────────────────────────────────── */

.fei-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--rf-space-1);
}

.fei-label {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

/* ── Mode toggle ──────────────────────────────────────────────────────────── */

.fei-modes {
  display: flex;
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-sm);
  overflow: hidden;
}

.fei-mode-btn {
  background: none;
  border: none;
  padding: 0.2rem 0.55rem;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  cursor: pointer;
  transition:
    background var(--rf-duration-fast) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out);
}

.fei-mode-btn--active {
  background: var(--rf-primary-soft);
  color: var(--rf-primary);
}

/* ── Type mode ────────────────────────────────────────────────────────────── */

.fei-type {
  position: relative;
}

.fei-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.fei-input {
  width: 100%;
  padding: 0.45rem 2.2rem 0.45rem var(--rf-space-3);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  background: var(--rf-surface-raised);
  color: var(--rf-text);
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-sm);
  outline: none;
  transition:
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    box-shadow var(--rf-duration-fast) var(--rf-ease-out);
}

.fei-input:focus {
  border-color: var(--rf-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rf-primary) 25%, transparent);
}

.fei-spinner {
  position: absolute;
  right: var(--rf-space-3);
  font-size: 0.7rem;
  color: var(--rf-primary);
  pointer-events: none;
}

/* ── Results dropdown ─────────────────────────────────────────────────────── */

.fei-results {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: var(--rf-space-1) 0;
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-md);
  box-shadow: var(--rf-shadow-md);
  max-height: 220px;
  overflow-y: auto;
}

.fei-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  cursor: pointer;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.fei-result:hover {
  background: var(--rf-surface-raised);
}

.fei-result-label {
  font-size: var(--rf-text-sm);
  color: var(--rf-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.fei-result-class {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  flex-shrink: 0;
}

.fei-hint {
  margin: var(--rf-space-2) 0 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
}

/* ── Selected chip ────────────────────────────────────────────────────────── */

.fei-chip {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  font-size: var(--rf-text-sm);
  min-height: 2.25rem;
}

.fei-chip-dot {
  font-size: 0.6rem;
  flex-shrink: 0;
}

.fei-chip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
}

.fei-chip-remove {
  background: none;
  border: none;
  padding: var(--rf-space-1);
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: var(--rf-radius-full);
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.fei-chip-remove:hover {
  color: var(--rf-danger);
  background: var(--rf-danger-soft);
}
</style>
