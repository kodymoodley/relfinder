<template>
  <main class="connection-view">
    <div
      class="connection-card"
      v-motion
      :initial="{ opacity: 0, y: 32 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 420, ease: 'easeOut' } }"
    >
      <div class="card-header">
        <div class="header-top">
          <h1 class="app-title">RelFinder</h1>
          <Button
            :icon="dark ? 'pi pi-sun' : 'pi pi-moon'"
            text
            rounded
            size="small"
            class="dark-toggle"
            @click="toggleDark"
            :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'"
          />
        </div>
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

    <ExamplesPanel />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import SparqlForm from '@/components/connection/SparqlForm.vue'
import RdfFileUpload from '@/components/connection/RdfFileUpload.vue'
import ExamplesPanel from '@/components/connection/ExamplesPanel.vue'
import { useDarkMode } from '@/composables/useDarkMode'

const activeTab = ref<'sparql' | 'file'>('sparql')
const { dark, toggle: toggleDark } = useDarkMode()
</script>

<style scoped>
.connection-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: var(--rf-space-10) var(--rf-space-4) var(--rf-space-12);
  background: var(--rf-bg);
  background-image:
    radial-gradient(ellipse 80% 50% at 50% -5%, rgb(8 145 178 / 0.09) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 85% 95%, rgb(245 158 11 / 0.06) 0%, transparent 55%);
}

.connection-card {
  width: 100%;
  max-width: 520px;
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-xl);
  overflow: hidden;
  box-shadow: var(--rf-shadow-xl);
}

.card-header {
  padding: var(--rf-space-8) var(--rf-space-8) var(--rf-space-6);
  border-bottom: 1px solid var(--rf-border);
  background: linear-gradient(160deg, var(--rf-surface) 0%, var(--rf-surface-raised) 100%);
  position: relative;
  overflow: hidden;
}

.header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--rf-space-1);
}

.dark-toggle {
  margin-top: -4px;
  color: var(--rf-text-subtle);
}

/* Accent gradient stripe at the top of the card */
.card-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--rf-primary) 0%, var(--rf-accent) 100%);
}

.app-title {
  margin: 0;
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-2xl);
  font-weight: var(--rf-weight-bold);
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--rf-primary) 20%, var(--rf-accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-subtitle {
  margin: 0;
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

/* ── Tab navigation ─────────────────────────────────────────────────────── */

.tab-nav {
  display: flex;
  border-bottom: 1px solid var(--rf-border);
  background: var(--rf-surface-raised);
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-3) var(--rf-space-4);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-family: var(--rf-font-body);
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text-muted);
  cursor: pointer;
  transition:
    color var(--rf-duration-fast) var(--rf-ease-out),
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    background var(--rf-duration-fast) var(--rf-ease-out);
}

.tab-btn:hover {
  color: var(--rf-text);
  background: var(--rf-surface);
}

.tab-btn--active {
  color: var(--rf-primary);
  border-bottom-color: var(--rf-primary);
  background: var(--rf-surface);
  font-weight: var(--rf-weight-semibold);
}

.tab-icon {
  font-size: var(--rf-text-sm);
}

/* Dark mode: brighter gradient so it reads on a near-black background */
:global(.dark) .connection-view {
  background-image:
    radial-gradient(ellipse 80% 50% at 50% -5%, rgb(34 211 238 / 0.08) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 85% 95%, rgb(251 191 36 / 0.06) 0%, transparent 55%);
}

/* ── Tab panel ──────────────────────────────────────────────────────────── */

.tab-panel {
  padding: var(--rf-space-6) var(--rf-space-8) var(--rf-space-8);
}

</style>
