<template>
  <main class="connection-view">
    <div class="connection-card">
      <h1 class="app-title">RelFinder</h1>
      <p class="app-subtitle">Discover relationships in RDF knowledge graphs</p>

      <!-- Source type selector -->
      <div class="source-tabs">
        <button
          :class="['tab', { active: activeTab === 'sparql' }]"
          @click="activeTab = 'sparql'"
        >
          SPARQL Endpoint
        </button>
        <button
          :class="['tab', { active: activeTab === 'file' }]"
          @click="activeTab = 'file'"
        >
          Upload File
        </button>
      </div>

      <!-- SPARQL endpoint form — placeholder, will be fleshed out in Stage 2 -->
      <div v-if="activeTab === 'sparql'" class="form-section">
        <p class="placeholder-note">
          SPARQL connection form coming in Stage 2.
        </p>
      </div>

      <!-- File upload — placeholder -->
      <div v-else class="form-section">
        <p class="placeholder-note">
          File upload coming in Stage 2.
        </p>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'

type Tab = 'sparql' | 'file'
const activeTab = ref<Tab>('sparql')
</script>

<style scoped>
.connection-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--rf-bg);
}

.connection-card {
  width: 100%;
  max-width: 480px;
  padding: 2.5rem;
  border-radius: 12px;
  background: var(--rf-surface);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

.app-title {
  margin: 0 0 0.25rem;
  font-size: 2rem;
  font-weight: 700;
  color: var(--rf-primary);
}

.app-subtitle {
  margin: 0 0 2rem;
  color: var(--rf-text-muted);
  font-size: 0.95rem;
}

.source-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.tab {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 1px solid var(--rf-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--rf-text-muted);
  transition: all 0.15s;
}

.tab.active {
  background: var(--rf-primary);
  border-color: var(--rf-primary);
  color: #fff;
}

.form-section {
  min-height: 120px;
}

.placeholder-note {
  color: var(--rf-text-muted);
  font-style: italic;
  font-size: 0.9rem;
}
</style>
