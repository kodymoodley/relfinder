<template>
  <div class="classes-panel">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="panel-header">
      <span class="panel-title">Classes</span>
      <span v-if="classes.length" class="panel-badge">{{ classes.length }}</span>
    </div>

    <!-- ── Search ──────────────────────────────────────────────────────────── -->
    <div class="search-bar">
      <i class="pi pi-search search-icon" />
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="Search classes and instances…"
        :disabled="loading"
      />
      <button
        v-if="searchQuery"
        class="search-clear"
        aria-label="Clear filter"
        @click="searchQuery = ''"
      >
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- ── Loading (initial class load) ───────────────────────────────────── -->
    <div v-if="loading" class="panel-feedback">
      <i class="pi pi-spin pi-spinner feedback-icon" />
      <span>Loading classes…</span>
    </div>

    <!-- ── Error ───────────────────────────────────────────────────────────── -->
    <Message v-else-if="error" severity="error" :closable="false" class="panel-error">
      {{ error }}
    </Message>

    <!-- ── Search results (flat list) ──────────────────────────────────────── -->
    <template v-else-if="searchQuery">
      <div v-if="searchMatches.length === 0" class="panel-feedback">
        <i class="pi pi-info-circle feedback-icon" />
        <span>No matches for "{{ searchQuery }}".</span>
      </div>
      <ul v-else class="class-list">
        <li v-for="item in searchMatches" :key="item.iri">
          <!-- Class match — click to expand -->
          <button
            v-if="item.type === 'class'"
            class="class-row"
            :class="{ 'class-row--active': expandedClass === item.iri }"
            :title="item.iri"
            @click="toggleClass(item as ClassInfo)"
          >
            <i
              class="pi class-chevron"
              :class="instancesLoading && expandedClass === item.iri ? 'pi-spin pi-spinner' : 'pi-tag'"
            />
            <span class="class-name">{{ item.label }}</span>
            <span class="class-count">{{ (item as ClassInfo).count.toLocaleString() }}</span>
          </button>

          <!-- Instance match — pin button -->
          <div
            v-else
            class="instance-item"
            :class="{ 'instance-item--pinned': pinnedStore.isPinned(item.iri) }"
            :title="item.iri"
          >
            <div class="instance-info">
              <span class="instance-label">{{ item.label }}</span>
              <span class="instance-class">{{ shortIri(item.classIri!) }}</span>
            </div>
            <button
              class="pin-btn"
              :class="{ 'pin-btn--active': pinnedStore.isPinned(item.iri) }"
              :disabled="pinnedStore.isFull && !pinnedStore.isPinned(item.iri)"
              :aria-label="pinnedStore.isPinned(item.iri) ? 'Unpin entity' : 'Pin entity'"
              @click.stop="togglePin(item.iri, item.label, item.classIri!)"
            >
              <i class="pi" :class="pinnedStore.isPinned(item.iri) ? 'pi-bookmark-fill' : 'pi-bookmark'" />
            </button>
          </div>
        </li>
      </ul>
    </template>

    <!-- ── Accordion (no search) ───────────────────────────────────────────── -->
    <template v-else>
      <div v-if="classes.length === 0" class="panel-feedback">
        <i class="pi pi-info-circle feedback-icon" />
        <span>No typed entities found.</span>
      </div>
      <ul v-else class="class-list">
        <li v-for="cls in classes" :key="cls.iri">
          <button
            class="class-row"
            :class="{ 'class-row--active': expandedClass === cls.iri }"
            :title="cls.iri"
            @click="toggleClass(cls)"
          >
            <i
              class="pi class-chevron"
              :class="
                instancesLoading && expandedClass === cls.iri
                  ? 'pi-spin pi-spinner'
                  : expandedClass === cls.iri
                    ? 'pi-chevron-down'
                    : 'pi-chevron-right'
              "
            />
            <span class="class-name">{{ cls.label }}</span>
            <span class="class-count">{{ cls.count.toLocaleString() }}</span>
          </button>

          <div v-if="expandedClass === cls.iri" class="instance-section">
            <div v-if="instancesLoading" class="instance-feedback">
              <span>Fetching instances…</span>
            </div>
            <div v-else-if="instancesError" class="instance-feedback instance-feedback--error">
              {{ instancesError }}
            </div>
            <div v-else-if="currentInstances.length === 0" class="instance-feedback">
              No instances found.
            </div>
            <ul v-else class="instance-list">
              <li
                v-for="inst in currentInstances"
                :key="inst.iri"
                class="instance-item"
                :class="{ 'instance-item--pinned': pinnedStore.isPinned(inst.iri) }"
                :title="inst.iri"
              >
                <span class="instance-label">{{ inst.label }}</span>
                <button
                  class="pin-btn"
                  :class="{ 'pin-btn--active': pinnedStore.isPinned(inst.iri) }"
                  :disabled="pinnedStore.isFull && !pinnedStore.isPinned(inst.iri)"
                  :aria-label="pinnedStore.isPinned(inst.iri) ? 'Unpin entity' : 'Pin entity'"
                  @click.stop="togglePin(inst.iri, inst.label, cls.iri)"
                >
                  <i class="pi" :class="pinnedStore.isPinned(inst.iri) ? 'pi-bookmark-fill' : 'pi-bookmark'" />
                </button>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { usePinnedStore } from '@/stores/pinned'
import { fetchClassesWithCounts, fetchInstancesByClass } from '@/lib/sparql/entitySearch'
import { cacheGet } from '@/lib/cache/queryCache'
import { shortIri } from '@/lib/utils/iri'
import type { ClassInfo } from '@/lib/sparql/types'

const connectionStore = useConnectionStore()
const pinnedStore = usePinnedStore()

// ── Class list ────────────────────────────────────────────────────────────────

const classes = ref<ClassInfo[]>([])
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  if (!ctx && !store) return

  loading.value = true
  error.value = ''
  try {
    classes.value = await fetchClassesWithCounts(ctx ?? { endpointUrl: '' }, store)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load classes.'
  } finally {
    loading.value = false
  }
})

// ── Search ────────────────────────────────────────────────────────────────────

const searchQuery = ref('')

// Flat items combining all classes and all instances loaded so far.
// Grows as the user expands classes — each expansion adds to the pool.
type FlatItem =
  | (ClassInfo & { type: 'class'; classIri?: undefined })
  | { type: 'instance'; iri: string; label: string; classIri: string }

const flatItems = computed<FlatItem[]>(() => {
  const items: FlatItem[] = classes.value.map((c) => ({ ...c, type: 'class' as const }))
  for (const [classIri, insts] of cachedInstances.value) {
    for (const inst of insts) {
      items.push({ type: 'instance', iri: inst.iri, label: inst.label, classIri })
    }
  }
  return items
})

const searchMatches = computed<FlatItem[]>(() => {
  if (!searchQuery.value) return []
  const q = searchQuery.value.toLowerCase()
  return flatItems.value.filter(
    (item) => item.label.toLowerCase().includes(q) || item.iri.toLowerCase().includes(q),
  )
})

// ── Instance expansion ────────────────────────────────────────────────────────

// Persists loaded instances across expand/collapse so they remain searchable.
const cachedInstances = ref(new Map<string, Array<{ iri: string; label: string }>>())

const expandedClass = ref<string | null>(null)
const instancesLoading = ref(false)
const instancesError = ref('')

const currentInstances = computed(() =>
  expandedClass.value ? (cachedInstances.value.get(expandedClass.value) ?? []) : [],
)

function togglePin(iri: string, label: string, classIri: string) {
  if (pinnedStore.isPinned(iri)) {
    pinnedStore.unpin(iri)
  } else {
    pinnedStore.pin({ iri, label, class: classIri })
  }
}

async function toggleClass(cls: ClassInfo) {
  if (expandedClass.value === cls.iri) {
    expandedClass.value = null
    return
  }

  expandedClass.value = cls.iri
  instancesError.value = ''

  if (cachedInstances.value.has(cls.iri)) return  // already loaded, no spinner needed

  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined
  const sourceKey = store ? 'file' : (ctx?.endpointUrl ?? '')
  const cacheKey = `instances:${sourceKey}:${cls.iri}`

  if (cacheGet(cacheKey)) {
    // Module-level cache hit — resolves instantly
    const result = await fetchInstancesByClass(cls.iri, ctx ?? { endpointUrl: '' }, store)
    cachedInstances.value.set(cls.iri, result)
    return
  }

  instancesLoading.value = true
  try {
    const result = await fetchInstancesByClass(cls.iri, ctx ?? { endpointUrl: '' }, store)
    cachedInstances.value.set(cls.iri, result)
  } catch (err) {
    instancesError.value = err instanceof Error ? err.message : 'Failed to load instances.'
  } finally {
    instancesLoading.value = false
  }
}
</script>

<style scoped>
.classes-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Header ─────────────────────────────────────────────────────────────── */

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-4) var(--rf-space-5);
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
}

.panel-title {
  font-family: var(--rf-font-display);
  font-weight: var(--rf-weight-semibold);
  font-size: var(--rf-text-sm);
  letter-spacing: -0.01em;
  color: var(--rf-text);
}

.panel-badge {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.5rem;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

.search-bar {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-3);
  border-bottom: 1px solid var(--rf-border);
  flex-shrink: 0;
}

.search-icon {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-sm);
  color: var(--rf-text);
  padding: var(--rf-space-1) 0;
}

.search-input::placeholder {
  color: var(--rf-text-subtle);
}

.search-input:disabled {
  opacity: 0.5;
}

.search-clear {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: var(--rf-text-xs);
  line-height: 1;
  display: flex;
  align-items: center;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.search-clear:hover {
  color: var(--rf-text);
}

/* ── Feedback states ─────────────────────────────────────────────────────── */

.panel-feedback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-3);
  flex: 1;
  padding: var(--rf-space-10) var(--rf-space-5);
  color: var(--rf-text-subtle);
  font-size: var(--rf-text-sm);
  text-align: center;
}

.feedback-icon {
  font-size: 1.25rem;
}

.panel-error {
  margin: var(--rf-space-4) var(--rf-space-5);
}

/* ── Class list ─────────────────────────────────────────────────────────── */

.class-list {
  list-style: none;
  margin: 0;
  padding: var(--rf-space-2) 0;
  overflow-y: auto;
  flex: 1;
}

.class-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-2) var(--rf-space-5);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.class-row:hover {
  background: var(--rf-surface-raised);
}

.class-row--active {
  background: var(--rf-primary-soft);
}

.class-row--active .class-name {
  color: var(--rf-primary);
}

.class-row--active .class-chevron {
  color: var(--rf-primary);
}

.class-chevron {
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
  flex-shrink: 0;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.class-name {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.class-count {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-subtle);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.45rem;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Instance section ───────────────────────────────────────────────────── */

.instance-section {
  background: var(--rf-bg);
  border-top: 1px solid var(--rf-border);
  border-bottom: 1px solid var(--rf-border);
}

.instance-feedback {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-3) var(--rf-space-5) var(--rf-space-3) calc(var(--rf-space-5) + 1.25rem);
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
}

.instance-feedback--error {
  color: var(--rf-danger);
}

.instance-list {
  list-style: none;
  margin: 0;
  padding: var(--rf-space-1) 0;
}

.instance-item {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-1) var(--rf-space-3) var(--rf-space-1) calc(var(--rf-space-5) + 1.25rem);
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

/* In search results mode, remove the indent */
.class-list > li > .instance-item {
  padding-left: var(--rf-space-5);
}

.instance-item:hover {
  background: var(--rf-surface-raised);
}

.instance-item--pinned {
  background: var(--rf-primary-soft);
}

.instance-item--pinned .instance-label {
  color: var(--rf-primary);
  font-weight: var(--rf-weight-medium);
}

.instance-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* Class name shown below the label in search results */
.instance-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.instance-class {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Pin button ─────────────────────────────────────────────────────────── */

.pin-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--rf-text-subtle);
  font-size: 0.65rem;
  line-height: 1;
  flex-shrink: 0;
  border-radius: var(--rf-radius-sm);
  opacity: 0;
  transition:
    opacity var(--rf-duration-fast) var(--rf-ease-out),
    color var(--rf-duration-fast) var(--rf-ease-out);
}

.instance-item:hover .pin-btn {
  opacity: 1;
}

.pin-btn--active {
  opacity: 1;
  color: var(--rf-primary);
}

.pin-btn:hover:not(:disabled) {
  color: var(--rf-primary);
}

.pin-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
