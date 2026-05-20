<template>
  <div class="file-upload">
    <!-- Drop zone -->
    <div
      class="drop-zone"
      :class="{ 'drop-zone--over': isDragging, 'drop-zone--loaded': !!loadedFile }"
      data-testid="rdf-drop-zone"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
      @click="fileInput?.click()"
    >
      <input
        id="rdf-file-upload"
        ref="fileInput"
        type="file"
        :accept="acceptedExtensions"
        class="hidden-input"
        aria-label="Upload RDF file"
        @change="onFileChange"
        data-testid="rdf-file-input"
      />

      <template v-if="!loadedFile && !parsing">
        <i class="pi pi-upload drop-icon" />
        <p class="drop-label">Drop an RDF file here or <span class="drop-link">browse</span></p>
        <p class="drop-hint">Supported formats: .ttl, .n3, .nt, .nq, .trig</p>
      </template>

      <template v-else-if="parsing">
        <i class="pi pi-spin pi-spinner drop-icon" />
        <p class="drop-label">Parsing {{ parsingFileName }}</p>
        <p class="drop-hint">{{ parseElapsed }}s elapsed — large files may take a moment</p>
      </template>

      <template v-else-if="loadedFile">
        <i class="pi pi-check-circle drop-icon drop-icon--success" />
        <p class="drop-label file-name">{{ loadedFile.name }}</p>
        <p class="drop-hint">{{ tripleCount.toLocaleString() }} triples loaded</p>
      </template>
    </div>

    <Message
      v-if="parseError"
      severity="error"
      :closable="true"
      @close="parseError = ''"
      data-testid="parse-error-msg"
    >
      {{ parseError }}
    </Message>

    <Button
      v-if="loadedFile"
      label="Open Graph Browser"
      icon="pi pi-arrow-right"
      icon-pos="right"
      fluid
      class="open-btn"
      data-testid="open-graph-btn"
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
const parsingFileName = ref('')
const parseElapsed = ref(0)
let parseTimer: ReturnType<typeof setInterval> | null = null

// ── File handling ─────────────────────────────────────────────────────────────

async function processFile(file: File) {
  parseError.value = ''
  parsing.value = true
  parsingFileName.value = file.name
  parseElapsed.value = 0
  loadedFile.value = null
  loadedStore.value = null
  parseTimer = setInterval(() => {
    parseElapsed.value++
  }, 1000)

  try {
    const store = await fileToStore(file)
    loadedStore.value = store
    tripleCount.value = storeSize(store)
    loadedFile.value = file
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : 'Failed to parse the RDF file.'
  } finally {
    parsing.value = false
    if (parseTimer) {
      clearInterval(parseTimer)
      parseTimer = null
    }
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

  router.push({ name: 'browse' })
}
</script>

<style scoped>
.file-upload {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-4);
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-2);
  padding: var(--rf-space-10) var(--rf-space-6);
  border: 2px dashed var(--rf-border);
  border-radius: var(--rf-radius-lg);
  cursor: pointer;
  transition:
    border-color var(--rf-duration-base) var(--rf-ease-out),
    background var(--rf-duration-base) var(--rf-ease-out);
  background: var(--rf-surface);
  min-height: 160px;
  text-align: center;
}

.drop-zone:hover,
.drop-zone--over {
  border-color: var(--rf-primary);
  background: var(--rf-primary-soft);
}

.drop-zone--loaded {
  border-style: solid;
  border-color: var(--rf-success);
  background: var(--rf-success-soft);
}

.hidden-input {
  display: none;
}

.drop-icon {
  font-size: 1.25rem;
  color: var(--rf-text-subtle);
  transition: color var(--rf-duration-base) var(--rf-ease-out);
}

.drop-zone:hover .drop-icon {
  color: var(--rf-primary);
}

.drop-icon--success {
  color: var(--rf-success);
}

.drop-label {
  margin: 0;
  font-size: var(--rf-text-base);
  font-weight: var(--rf-weight-medium);
  color: var(--rf-text);
}

.file-name {
  font-weight: var(--rf-weight-semibold);
  word-break: break-all;
}

.drop-link {
  color: var(--rf-primary);
  text-decoration: underline;
  font-weight: var(--rf-weight-medium);
}

.drop-hint {
  margin: 0;
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
}

.open-btn {
  margin-top: var(--rf-space-1);
}
</style>
