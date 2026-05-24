<template>
  <Teleport to="body">
    <Transition name="palette-fade">
      <div v-if="visible" class="palette-backdrop" @click.self="close">
        <div class="palette-box" role="dialog" aria-modal="true" aria-label="Search">
          <div class="palette-input-row">
            <i class="pi pi-search palette-search-icon" />
            <input
              ref="inputRef"
              v-model="query"
              class="palette-input"
              placeholder="Search classes, properties, instances…"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKeydown"
              @input="onInput"
            />
            <kbd class="palette-kbd">Esc</kbd>
          </div>

          <ul v-if="results.length > 0" ref="listRef" class="palette-list" role="listbox">
            <li
              v-for="(result, i) in results"
              :key="result.iri"
              :class="['palette-item', { 'palette-item--active': i === activeIndex }]"
              role="option"
              :aria-selected="i === activeIndex"
              @click="onSelect(result)"
              @pointermove="activeIndex = i"
            >
              <span class="palette-label">{{ result.label }}</span>
              <Tag :value="result.typeLabel" :severity="result.severity" class="palette-tag" />
            </li>
          </ul>

          <p v-else-if="query.trim() && !loading" class="palette-empty">
            No results for "{{ query.trim() }}"
          </p>

          <p v-else-if="!query.trim()" class="palette-hint">Start typing to search…</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Tag from 'primevue/tag'
import { useSearchIndex } from '@/composables/useSearchIndex'
import { weightedSumFusion } from '@/lib/search/fusion/weightedSum'
import { snapshot } from '@/lib/search/interestModel'
import type { ScoredEntity } from '@/lib/search/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'
const MAX_RESULTS = 20

// ── Types ─────────────────────────────────────────────────────────────────────

type TagSeverity = 'info' | 'secondary' | 'success'

interface PaletteResult {
  iri: string
  label: string
  classIri: string
  typeLabel: string
  severity: TagSeverity
}

// ── Props / model ─────────────────────────────────────────────────────────────

const visible = defineModel<boolean>('visible', { required: true })

// ── Composables ───────────────────────────────────────────────────────────────

const router = useRouter()
const { search: searchIndex } = useSearchIndex()

// ── State ─────────────────────────────────────────────────────────────────────

const query = ref('')
const results = ref<PaletteResult[]>([])
const loading = ref(false)
const activeIndex = ref(-1)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLUListElement | null>(null)

// ── Open / close ──────────────────────────────────────────────────────────────

function close() {
  visible.value = false
}

watch(visible, async (open) => {
  if (open) {
    query.value = ''
    results.value = []
    activeIndex.value = -1
    await nextTick()
    inputRef.value?.focus()
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function toResult(e: ScoredEntity): PaletteResult {
  let typeLabel: string
  let severity: TagSeverity
  if (e.classIri === OWL_CLASS) {
    typeLabel = 'Class'
    severity = 'info'
  } else if (e.classIri === OWL_OBJECT_PROPERTY) {
    typeLabel = 'Property'
    severity = 'secondary'
  } else {
    typeLabel = e.classLabel || 'Instance'
    severity = 'success'
  }
  return { iri: e.iri, label: e.label, classIri: e.classIri, typeLabel, severity }
}

// ── Search ────────────────────────────────────────────────────────────────────

async function onInput() {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    activeIndex.value = -1
    return
  }
  loading.value = true
  try {
    const raw = await searchIndex(q, MAX_RESULTS)
    const fused = weightedSumFusion.fuse(raw, [], snapshot())
    results.value = fused.map(toResult)
    activeIndex.value = results.value.length > 0 ? 0 : -1
  } finally {
    loading.value = false
  }
}

// ── Keyboard navigation ───────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (results.value.length === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % results.value.length
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const r = results.value[activeIndex.value]
    if (r) onSelect(r)
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = listRef.value?.children[activeIndex.value] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  })
}

// ── Selection / navigation ────────────────────────────────────────────────────

function onSelect(result: PaletteResult) {
  close()
  if (result.classIri === OWL_CLASS || result.classIri === OWL_OBJECT_PROPERTY) {
    router.push({ name: 'browse' })
  } else {
    router.push({
      name: 'graph',
      state: {
        example: {
          entity1: { iri: result.iri, label: result.label, class: result.classIri },
          entity2: null,
        },
      },
    })
  }
}
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: color-mix(in srgb, var(--rf-overlay) 60%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
}

.palette-box {
  width: min(640px, calc(100vw - var(--rf-space-8)));
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-lg);
  box-shadow: var(--rf-shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  padding: var(--rf-space-3) var(--rf-space-4);
  border-bottom: 1px solid var(--rf-border);
}

.palette-search-icon {
  color: var(--rf-text-subtle);
  font-size: 1rem;
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--rf-text-base);
  color: var(--rf-text);
  caret-color: var(--rf-primary);
}

.palette-input::placeholder {
  color: var(--rf-text-subtle);
}

.palette-kbd {
  font-family: inherit;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-sm);
  padding: 2px var(--rf-space-2);
  flex-shrink: 0;
}

.palette-list {
  list-style: none;
  margin: 0;
  padding: var(--rf-space-2) 0;
  overflow-y: auto;
  flex: 1;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-3);
  padding: var(--rf-space-2) var(--rf-space-4);
  cursor: pointer;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.palette-item--active {
  background: var(--rf-surface-raised);
}

.palette-label {
  flex: 1;
  font-size: var(--rf-text-sm);
  color: var(--rf-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-tag {
  flex-shrink: 0;
  font-size: var(--rf-text-xs);
}

.palette-empty,
.palette-hint {
  margin: 0;
  padding: var(--rf-space-4) var(--rf-space-4);
  font-size: var(--rf-text-sm);
  color: var(--rf-text-subtle);
  text-align: center;
}

/* ── Transition ──────────────────────────────────────────────────────────────*/

.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity var(--rf-duration-base) var(--rf-ease-out);
}

.palette-fade-enter-active .palette-box,
.palette-fade-leave-active .palette-box {
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}

.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}

.palette-fade-enter-from .palette-box,
.palette-fade-leave-to .palette-box {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
