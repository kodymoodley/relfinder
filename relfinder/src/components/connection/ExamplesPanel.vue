<template>
  <div class="examples-panel">
    <h2
      class="examples-heading"
      v-motion
      :initial="{ opacity: 0, y: 16 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 360, ease: 'easeOut' } }"
    >Quick-start examples</h2>
    <p
      class="examples-subheading"
      v-motion
      :initial="{ opacity: 0, y: 12 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 360, delay: 80, ease: 'easeOut' } }"
    >
      Click any example to load the dataset and run the query instantly — no setup required.
    </p>

    <div class="examples-grid">
      <div
        v-for="(example, idx) in EXAMPLES"
        :key="example.id"
        class="example-card"
        :class="{ 'example-card--sparql': example.kind === 'sparql' }"
        v-motion
        :initial="{ opacity: 0, y: 24 }"
        :enter="{ opacity: 1, y: 0, transition: { duration: 380, delay: 160 + idx * 70, ease: 'easeOut' } }"
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
  margin: var(--rf-space-8) auto 0;
  padding: 0 var(--rf-space-4) var(--rf-space-12);
}

.examples-heading {
  margin: 0 0 var(--rf-space-1);
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-lg);
  font-weight: var(--rf-weight-bold);
  letter-spacing: -0.02em;
  color: var(--rf-text);
  text-align: center;
}

.examples-subheading {
  margin: 0 0 var(--rf-space-5);
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
  text-align: center;
  line-height: var(--rf-leading-relaxed);
}

.examples-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--rf-space-4);
}

/* ── Card ────────────────────────────────────────────────────────────────── */

.example-card {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-3);
  padding: var(--rf-space-5);
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-lg);
  transition:
    box-shadow var(--rf-duration-base) var(--rf-ease-out),
    border-color var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}

.example-card:hover {
  box-shadow: var(--rf-shadow-lg);
  border-color: var(--rf-primary);
  transform: translateY(-2px);
}

.example-card--sparql {
  border-style: dashed;
}

/* ── Kind badge ──────────────────────────────────────────────────────────── */

.kind-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--rf-space-1);
  align-self: flex-start;
  padding: 0.2rem 0.6rem;
  border-radius: var(--rf-radius-full);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  letter-spacing: 0.04em;
}

.kind-badge--ttl {
  background: var(--rf-primary-soft);
  color: var(--rf-primary);
  border: 1px solid rgb(8 145 178 / 0.25);
}

.kind-badge--sparql {
  background: var(--rf-accent-soft);
  color: var(--rf-accent-hover);
  border: 1px solid rgb(245 158 11 / 0.3);
}

/* ── Card content ────────────────────────────────────────────────────────── */

.card-title {
  margin: 0;
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-base);
  font-weight: var(--rf-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--rf-text);
  line-height: var(--rf-leading-tight);
}

.card-description {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
  flex: 1;
}

/* ── Entity pair ─────────────────────────────────────────────────────────── */

.entity-pair {
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  flex-wrap: wrap;
}

.entity-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--rf-space-1);
  padding: 0.2rem 0.55rem;
  border-radius: var(--rf-radius-full);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-medium);
  border: 1px solid var(--rf-border);
  background: var(--rf-surface-raised);
  white-space: nowrap;
}

.entity-chip--1 .pi-circle-fill { color: var(--rf-node-entity1); font-size: 0.5rem; }
.entity-chip--2 .pi-circle-fill { color: var(--rf-node-entity2); font-size: 0.5rem; }

.pair-arrow {
  font-size: 0.7rem;
  color: var(--rf-text-subtle);
  flex-shrink: 0;
}

/* ── Error ───────────────────────────────────────────────────────────────── */

.card-error {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-danger);
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
}
</style>
