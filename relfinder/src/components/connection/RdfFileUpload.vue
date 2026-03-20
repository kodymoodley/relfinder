<template>
  <div class="file-upload">
    <!-- Drop zone -->
    <div
      class="drop-zone"
      :class="{ 'drop-zone--over': isDragging, 'drop-zone--loaded': !!loadedFile }"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
      @click="fileInput?.click()"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="acceptedExtensions"
        class="hidden-input"
        @change="onFileChange"
      />

      <template v-if="!loadedFile && !parsing">
        <i class="pi pi-upload drop-icon" />
        <p class="drop-label">
          Drop an RDF file here or <span class="drop-link">browse</span>
        </p>
        <p class="drop-hint">Supported formats: .ttl, .n3, .nt, .nq, .trig</p>
      </template>

      <template v-else-if="parsing">
        <i class="pi pi-spin pi-spinner drop-icon" />
        <p class="drop-label">Parsing…</p>
      </template>

      <template v-else-if="loadedFile">
        <i class="pi pi-check-circle drop-icon drop-icon--success" />
        <p class="drop-label file-name">{{ loadedFile.name }}</p>
        <p class="drop-hint">{{ tripleCount.toLocaleString() }} triples loaded</p>
      </template>
    </div>

    <Message v-if="parseError" severity="error" :closable="true" @close="parseError = ''">
      {{ parseError }}
    </Message>

    <Button
      v-if="loadedFile"
      label="Open Graph Browser"
      icon="pi pi-arrow-right"
      icon-pos="right"
      fluid
      class="open-btn"
      @click="onConnect"
    />

    <Button
      v-if="loadedFile"
      label="Choose a different file"
      severity="secondary"
      text
      fluid
      @click="reset"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { fileToStore, storeSize } from '@/lib/rdf/parser'
import type { Store } from 'n3'

const router = useRouter()
const connectionStore = useConnectionStore()

const acceptedExtensions = '.ttl,.n3,.nt,.nq,.trig'

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const parsing = ref(false)
const parseError = ref('')
const loadedFile = ref<File | null>(null)
const loadedStore = ref<Store | null>(null)
const tripleCount = ref(0)

// ── File handling ─────────────────────────────────────────────────────────────

async function processFile(file: File) {
  parseError.value = ''
  parsing.value = true
  loadedFile.value = null
  loadedStore.value = null

  try {
    const store = await fileToStore(file)
    loadedStore.value = store
    tripleCount.value = storeSize(store)
    loadedFile.value = file
  } catch (err) {
    parseError.value =
      err instanceof Error ? err.message : 'Failed to parse the RDF file.'
  } finally {
    parsing.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) processFile(file)
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) processFile(file)
}

function reset() {
  loadedFile.value = null
  loadedStore.value = null
  tripleCount.value = 0
  parseError.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

// ── Connect ───────────────────────────────────────────────────────────────────

function onConnect() {
  if (!loadedFile.value || !loadedStore.value) return

  connectionStore.connectFile({
    fileName: loadedFile.value.name,
    store: loadedStore.value,
  })

  router.push({ name: 'graph' })
}
</script>

<style scoped>
.file-upload {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem 1.5rem;
  border: 2px dashed var(--p-content-border-color);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  background: var(--p-content-background);
  min-height: 160px;
  text-align: center;
}

.drop-zone:hover,
.drop-zone--over {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}

.drop-zone--loaded {
  border-style: solid;
  border-color: var(--p-green-500);
  background: color-mix(in srgb, var(--p-green-500) 5%, transparent);
}

.hidden-input {
  display: none;
}

.drop-icon {
  font-size: 2rem;
  color: var(--p-text-muted-color);
}

.drop-icon--success {
  color: var(--p-green-500);
}

.drop-label {
  margin: 0;
  font-size: 0.95rem;
  color: var(--p-text-color);
}

.file-name {
  font-weight: 600;
  word-break: break-all;
}

.drop-link {
  color: var(--p-primary-color);
  text-decoration: underline;
}

.drop-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.open-btn {
  margin-top: 0.25rem;
}
</style>
