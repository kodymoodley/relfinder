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
        placeholder="Filter classes or instances…"
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

    <!-- ── Loading ─────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="panel-feedback">
      <i class="pi pi-spin pi-spinner feedback-icon" />
      <span>Loading classes…</span>
    </div>

    <!-- ── Error ───────────────────────────────────────────────────────────── -->
    <Message v-else-if="error" severity="error" :closable="false" class="panel-error">
      {{ error }}
    </Message>

    <!-- ── Empty ───────────────────────────────────────────────────────────── -->
    <div v-else-if="filteredClasses.length === 0" class="panel-feedback">
      <i class="pi pi-info-circle feedback-icon" />
      <span>{{ searchQuery ? 'No classes match your filter.' : 'No typed entities found.' }}</span>
    </div>

    <!-- ── Class list ──────────────────────────────────────────────────────── -->
    <ul v-else class="class-list">
      <li v-for="cls in filteredClasses" :key="cls.iri">
        <!-- Class row -->
        <button
          class="class-row"
          :class="{ 'class-row--active': expandedClass === cls.iri }"
          :title="cls.iri"
          @click="toggleClass(cls)"
        >
          <i
            class="pi class-chevron"
            :class="expandedClass === cls.iri ? 'pi-chevron-down' : 'pi-chevron-right'"
          />
          <span class="class-name">{{ cls.label }}</span>
          <span class="class-count">{{ cls.count.toLocaleString() }}</span>
        </button>

        <!-- Instance list (expanded) -->
        <div v-if="expandedClass === cls.iri" class="instance-section">
          <div v-if="instancesLoading" class="instance-feedback">
            <i class="pi pi-spin pi-spinner" />
            <span>Loading instances…</span>
          </div>
          <div v-else-if="instancesError" class="instance-feedback instance-feedback--error">
            {{ instancesError }}
          </div>
          <div
            v-else-if="filteredInstances.length === 0"
            class="instance-feedback"
          >
            {{ searchQuery ? 'No instances match your filter.' : 'No instances found.' }}
          </div>
          <ul v-else class="instance-list">
            <li
              v-for="inst in filteredInstances"
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
                @click.stop="togglePin(inst, expandedClass!)"
              >
                <i
                  class="pi"
                  :class="pinnedStore.isPinned(inst.iri) ? 'pi-bookmark-fill' : 'pi-bookmark'"
                />
              </button>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { usePinnedStore } from '@/stores/pinned'
import { fetchClassesWithCounts, fetchInstancesByClass } from '@/lib/sparql/entitySearch'
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

const filteredClasses = computed(() => {
  if (!searchQuery.value) return classes.value
  const q = searchQuery.value.toLowerCase()
  return classes.value.filter((c) => c.label.toLowerCase().includes(q) || c.iri.toLowerCase().includes(q))
})

// ── Instance expansion ────────────────────────────────────────────────────────

const expandedClass = ref<string | null>(null)
const instances = ref<Array<{ iri: string; label: string }>>([])
const instancesLoading = ref(false)
const instancesError = ref('')

const filteredInstances = computed(() => {
  if (!searchQuery.value) return instances.value
  const q = searchQuery.value.toLowerCase()
  return instances.value.filter(
    (i) => i.label.toLowerCase().includes(q) || i.iri.toLowerCase().includes(q),
  )
})

function togglePin(inst: { iri: string; label: string }, classIri: string) {
  if (pinnedStore.isPinned(inst.iri)) {
    pinnedStore.unpin(inst.iri)
  } else {
    pinnedStore.pin({ iri: inst.iri, label: inst.label, class: classIri })
  }
}

async function toggleClass(cls: ClassInfo) {
  if (expandedClass.value === cls.iri) {
    expandedClass.value = null
    return
  }

  expandedClass.value = cls.iri
  instancesLoading.value = true
  instancesError.value = ''
  instances.value = []

  const ctx = connectionStore.queryContext
  const store = connectionStore.rdfStore ?? undefined

  try {
    instances.value = await fetchInstancesByClass(cls.iri, ctx ?? { endpointUrl: '' }, store)
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

.instance-item:hover {
  background: var(--rf-surface-raised);
}

.instance-label {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.instance-item--pinned {
  background: var(--rf-primary-soft);
}

.instance-item--pinned .instance-label {
  color: var(--rf-primary);
  font-weight: var(--rf-weight-medium);
}

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
