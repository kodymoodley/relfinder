<template>
  <div class="examples-panel">
    <h2 class="examples-heading">Quick-start examples</h2>
    <p class="examples-subheading">
      Click any example to load the dataset and run the query instantly — no setup required.
    </p>

    <div class="examples-grid">
      <div
        v-for="example in EXAMPLES"
        :key="example.id"
        class="example-card"
        :class="{ 'example-card--sparql': example.kind === 'sparql' }"
      >
        <!-- Kind badge -->
        <span class="kind-badge" :class="`kind-badge--${example.kind}`">
          <i :class="example.kind === 'ttl' ? 'pi pi-file' : 'pi pi-server'" />
          {{ example.kind === 'ttl' ? 'Local file' : 'Live SPARQL' }}
        </span>

        <h3 class="card-title">{{ example.title }}</h3>
        <p class="card-description">{{ example.description }}</p>

        <!-- Entity pair -->
        <div class="entity-pair">
          <span class="entity-chip entity-chip--1">
            <i class="pi pi-circle-fill" />
            {{ example.entity1.label }}
          </span>
          <i class="pi pi-arrows-h pair-arrow" />
          <span class="entity-chip entity-chip--2">
            <i class="pi pi-circle-fill" />
            {{ example.entity2.label }}
          </span>
        </div>

        <Button
          label="Try this example"
          icon="pi pi-play"
          size="small"
          fluid
          :loading="loadingId === example.id"
          :disabled="!!loadingId && loadingId !== example.id"
          @click="runExample(example)"
        />

        <p v-if="errorId === example.id" class="card-error">
          <i class="pi pi-exclamation-triangle" /> {{ errorMessage }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { EXAMPLES } from '@/lib/examples'
import type { Example } from '@/lib/examples'
import { parseRdfContent } from '@/lib/rdf/parser'
import { useConnectionStore } from '@/stores/connection'

const router = useRouter()
const connectionStore = useConnectionStore()

const loadingId = ref<string | null>(null)
const errorId = ref<string | null>(null)
const errorMessage = ref('')

async function runExample(example: Example) {
  loadingId.value = example.id
  errorId.value = null
  errorMessage.value = ''

  try {
    if (example.kind === 'ttl') {
      const store = await parseRdfContent(example.ttlContent, 'text/turtle')
      connectionStore.connectFile({ fileName: example.fileName, store })
    } else {
      connectionStore.connectSparql({
        endpointUrl: example.endpointUrl,
        username: '',
        password: '',
        proxyUrl: '',
      })
    }

    await router.push({
      name: 'graph',
      // Cast needed: HistoryState only accepts index-signature types, but the
      // data is plain-serializable at runtime so the cast is safe.
      state: JSON.parse(JSON.stringify({
        example: {
          entity1: example.entity1,
          entity2: example.entity2,
          options: example.options,
        },
      })),
    })
  } catch (err) {
    errorId.value = example.id
    errorMessage.value = err instanceof Error ? err.message : 'Failed to load example.'
  } finally {
    loadingId.value = null
  }
}
</script>

<style scoped>
.examples-panel {
  width: 100%;
  max-width: 1100px;
  margin: 2rem auto 0;
  padding: 0 1rem 3rem;
}

.examples-heading {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-text-color);
  text-align: center;
}

.examples-subheading {
  margin: 0 0 1.25rem;
  font-size: 0.82rem;
  color: var(--p-text-muted-color);
  text-align: center;
}

.examples-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

/* ── Card ────────────────────────────────────────────────────────────────── */

.example-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.1rem 1.25rem 1.25rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.example-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  border-color: var(--p-primary-200, #93c5fd);
}

.example-card--sparql {
  border-style: dashed;
}

/* ── Kind badge ──────────────────────────────────────────────────────────── */

.kind-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  align-self: flex-start;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.kind-badge--ttl {
  background: var(--p-primary-50, #eff6ff);
  color: var(--p-primary-600, #2563eb);
  border: 1px solid var(--p-primary-200, #bfdbfe);
}

.kind-badge--sparql {
  background: var(--p-orange-50, #fff7ed);
  color: var(--p-orange-600, #ea580c);
  border: 1px solid var(--p-orange-200, #fed7aa);
}

/* ── Card content ────────────────────────────────────────────────────────── */

.card-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--p-text-color);
  line-height: 1.3;
}

.card-description {
  margin: 0;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  line-height: 1.5;
  flex: 1;
}

/* ── Entity pair ─────────────────────────────────────────────────────────── */

.entity-pair {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.entity-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 500;
  border: 1px solid var(--p-content-border-color);
  background: var(--p-surface-100);
  white-space: nowrap;
}

.entity-chip--1 .pi-circle-fill { color: #4f8ef7; font-size: 0.5rem; }
.entity-chip--2 .pi-circle-fill { color: #f76b4f; font-size: 0.5rem; }

.pair-arrow {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

/* ── Error ───────────────────────────────────────────────────────────────── */

.card-error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-red-500);
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
</style>
