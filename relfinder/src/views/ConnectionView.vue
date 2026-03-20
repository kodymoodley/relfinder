<template>
  <main class="connection-view">
    <div class="connection-card">
      <div class="card-header">
        <h1 class="app-title">RelFinder</h1>
        <p class="app-subtitle">Discover relationships in RDF knowledge graphs</p>
      </div>

      <!-- Custom tabs — avoids PrimeVue Tabs provide/inject context bug in Vue 3.5 -->
      <div class="tab-nav" role="tablist">
        <button
          role="tab"
          class="tab-btn"
          :class="{ 'tab-btn--active': activeTab === 'sparql' }"
          :aria-selected="activeTab === 'sparql'"
          @click="activeTab = 'sparql'"
        >
          <i class="pi pi-server tab-icon" />
          SPARQL Endpoint
        </button>
        <button
          role="tab"
          class="tab-btn"
          :class="{ 'tab-btn--active': activeTab === 'file' }"
          :aria-selected="activeTab === 'file'"
          @click="activeTab = 'file'"
        >
          <i class="pi pi-file tab-icon" />
          Upload File
        </button>
      </div>

      <div class="tab-panel">
        <SparqlForm v-if="activeTab === 'sparql'" />
        <RdfFileUpload v-else />
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SparqlForm from '@/components/connection/SparqlForm.vue'
import RdfFileUpload from '@/components/connection/RdfFileUpload.vue'

const activeTab = ref<'sparql' | 'file'>('sparql')
</script>

<style scoped>
.connection-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem 1rem;
  background: var(--p-surface-ground);
}

.connection-card {
  width: 100%;
  max-width: 520px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  overflow: hidden;
}

.card-header {
  padding: 2rem 2rem 1.25rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.app-title {
  margin: 0 0 0.25rem;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--p-primary-color);
}

.app-subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
}

/* ── Tab navigation ─────────────────────────────────────────────────────── */

.tab-nav {
  display: flex;
  border-bottom: 1px solid var(--p-content-border-color);
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover {
  color: var(--p-text-color);
}

.tab-btn--active {
  color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
}

.tab-icon {
  font-size: 0.85rem;
}

/* ── Tab panel ──────────────────────────────────────────────────────────── */

.tab-panel {
  padding: 1.5rem 2rem 2rem;
}
</style>
