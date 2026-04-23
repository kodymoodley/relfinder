<template>
  <div class="classes-panel">
    <div class="panel-header">
      <span class="panel-title">Classes</span>
      <span v-if="classes.length" class="panel-badge">{{ classes.length }}</span>
    </div>

    <div v-if="loading" class="panel-feedback">
      <i class="pi pi-spin pi-spinner feedback-icon" />
      <span>Loading classes…</span>
    </div>

    <Message v-else-if="error" severity="error" :closable="false" class="panel-error">
      {{ error }}
    </Message>

    <div v-else-if="classes.length === 0" class="panel-feedback">
      <i class="pi pi-info-circle feedback-icon" />
      <span>No typed entities found.</span>
    </div>

    <ul v-else class="class-list">
      <li
        v-for="cls in classes"
        :key="cls.iri"
        class="class-item"
        :title="cls.iri"
      >
        <span class="class-name">{{ cls.label }}</span>
        <span class="class-count">{{ cls.count.toLocaleString() }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { fetchClassesWithCounts } from '@/lib/sparql/entitySearch'
import type { ClassInfo } from '@/lib/sparql/types'

const connectionStore = useConnectionStore()

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
    classes.value = await fetchClassesWithCounts(
      ctx ?? { endpointUrl: '' },
      store,
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load classes.'
  } finally {
    loading.value = false
  }
})
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
  color: var(--rf-text-subtle);
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

.class-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--rf-space-2) var(--rf-space-5);
  gap: var(--rf-space-3);
  cursor: default;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
}

.class-item:hover {
  background: var(--rf-surface-raised);
}

.class-name {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
