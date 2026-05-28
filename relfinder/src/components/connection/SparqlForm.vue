<template>
  <form class="sparql-form" @submit.prevent="onSubmit">
    <!-- Sample databases collapsible (expanded by default) -->
    <div class="collapsible">
      <button type="button" class="collapsible-toggle" @click="showSamples = !showSamples">
        <span class="collapsible-label">Sample databases</span>
        <span class="collapsible-badge">click to connect</span>
        <i
          :class="['pi', showSamples ? 'pi-chevron-up' : 'pi-chevron-down', 'collapsible-chevron']"
        />
      </button>
      <Transition name="collapse">
        <div v-show="showSamples" class="collapsible-body">
          <p class="fieldset-hint">
            Select any database below to connect instantly — no configuration needed.
          </p>
          <div class="endpoint-grid">
            <button
              v-for="entry in ENDPOINT_DIRECTORY"
              :key="entry.id"
              type="button"
              class="endpoint-card"
              :disabled="connecting"
              @click="connectEndpoint(entry)"
            >
              <span class="endpoint-card-name">{{ entry.name }}</span>
              <span class="endpoint-card-domain">{{ entry.domain }}</span>
              <span class="endpoint-card-desc">{{ entry.description }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <div class="field">
      <label for="endpointUrl"
        >Or enter a SPARQL endpoint URL <span class="required">*</span></label
      >
      <InputText
        id="endpointUrl"
        v-model="form.endpointUrl"
        placeholder=""
        :invalid="!!errors.endpointUrl"
        fluid
        autocomplete="url"
        data-testid="endpoint-url-input"
      />
      <small v-if="httpsConverted" class="https-notice">
        <i class="pi pi-lock" /> URL automatically upgraded to HTTPS
      </small>
      <small v-else-if="errors.endpointUrl" class="error-msg">{{ errors.endpointUrl }}</small>
    </div>

    <!-- Authentication collapsible -->
    <div class="collapsible">
      <button type="button" class="collapsible-toggle" @click="showAuth = !showAuth">
        <span class="collapsible-label">Authentication</span>
        <span class="collapsible-badge">optional</span>
        <i :class="['pi', showAuth ? 'pi-chevron-up' : 'pi-chevron-down', 'collapsible-chevron']" />
      </button>
      <Transition name="collapse">
        <div v-show="showAuth" class="collapsible-body">
          <div class="field">
            <label for="username">Username</label>
            <InputText
              id="username"
              v-model="form.username"
              placeholder="username"
              fluid
              autocomplete="username"
            />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <Password
              inputId="password"
              v-model="form.password"
              placeholder="password"
              :feedback="false"
              fluid
              toggleMask
              autocomplete="current-password"
            />
          </div>
        </div>
      </Transition>
    </div>

    <!-- CORS Proxy collapsible -->
    <div class="collapsible">
      <button type="button" class="collapsible-toggle" @click="showProxy = !showProxy">
        <span class="collapsible-label">CORS Proxy</span>
        <span class="collapsible-badge">optional</span>
        <i
          :class="['pi', showProxy ? 'pi-chevron-up' : 'pi-chevron-down', 'collapsible-chevron']"
        />
      </button>
      <Transition name="collapse">
        <div v-show="showProxy" class="collapsible-body">
          <p class="fieldset-hint">
            Only needed when your SPARQL endpoint does not support cross-origin requests. Start the
            bundled Caddy proxy and enter its URL here.
          </p>
          <div class="field">
            <label for="proxyUrl">Proxy URL</label>
            <InputText
              id="proxyUrl"
              v-model="form.proxyUrl"
              placeholder="http://localhost:8080/sparql"
              :invalid="!!errors.proxyUrl"
              fluid
              autocomplete="url"
            />
            <small v-if="errors.proxyUrl" class="error-msg">{{ errors.proxyUrl }}</small>
          </div>
        </div>
      </Transition>
    </div>

    <Button
      type="submit"
      :label="connecting ? `Connecting to ${connectingHost}…` : 'Connect'"
      icon="pi pi-plug"
      :loading="connecting"
      fluid
      class="connect-btn"
      data-testid="connect-btn"
    />

    <Message
      v-if="connectionError"
      severity="error"
      :closable="true"
      :pt="{ root: { role: 'alert' } }"
      @close="connectionError = ''"
      data-testid="connection-error-msg"
    >
      {{ connectionError }}
    </Message>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { useSchemaStore } from '@/stores/schema'
import { executeSelect } from '@/lib/sparql/engine'
import { loadSchema } from '@/lib/cache/schemaStorage'
import { ENDPOINT_DIRECTORY } from '@/lib/data/endpointDirectory'
import type { EndpointEntry } from '@/lib/data/endpointDirectory'

const router = useRouter()
const connectionStore = useConnectionStore()
const schemaStore = useSchemaStore()

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  endpointUrl: string
  username: string
  password: string
  proxyUrl: string
}

const savedEndpoint = sessionStorage.getItem('rf:endpointUrl') ?? ''
const savedProxy = sessionStorage.getItem('rf:proxyUrl') ?? ''

const form = reactive<FormState>({
  endpointUrl: savedEndpoint,
  username: '',
  password: '',
  proxyUrl: savedProxy,
})

const errors = reactive<Partial<FormState>>({})
const connecting = ref(false)
const connectingHost = ref('')
const connectionError = ref('')
const showAuth = ref(false)
const showProxy = ref(false)
const showSamples = ref(false)
const httpsConverted = ref(false)

let httpsNoticeTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => form.endpointUrl,
  (val) => {
    if (val.startsWith('http://') && !val.startsWith('http://localhost')) {
      form.endpointUrl = 'https://' + val.slice(7)
      httpsConverted.value = true
      if (httpsNoticeTimer) clearTimeout(httpsNoticeTimer)
      httpsNoticeTimer = setTimeout(() => {
        httpsConverted.value = false
      }, 4000)
    }
  },
)

// ── Validation ────────────────────────────────────────────────────────────────

function validate(): boolean {
  errors.endpointUrl = ''
  errors.proxyUrl = ''

  if (!form.endpointUrl.trim()) {
    errors.endpointUrl = 'Endpoint URL is required.'
    return false
  }

  try {
    new URL(form.endpointUrl.trim())
  } catch {
    errors.endpointUrl = 'Must be a valid URL (e.g. https://dbpedia.org/sparql).'
    return false
  }

  if (form.proxyUrl.trim()) {
    try {
      new URL(form.proxyUrl.trim())
    } catch {
      errors.proxyUrl = 'Proxy URL must be a valid URL.'
      return false
    }
  }

  return true
}

// ── Sample database auto-connect ──────────────────────────────────────────────

async function connectEndpoint(entry: EndpointEntry) {
  form.endpointUrl = entry.url
  form.username = ''
  form.password = ''
  form.proxyUrl = entry.proxyUrl ?? ''
  console.log('[SparqlForm] connectEndpoint', {
    id: entry.id,
    url: entry.url,
    proxyUrl: entry.proxyUrl,
  })
  await onSubmit()
}

// ── Connection ────────────────────────────────────────────────────────────────

/**
 * Fires a lightweight ASK query to verify the endpoint is reachable and
 * returns SPARQL results before committing to the connection store.
 */
async function testConnection(
  endpointUrl: string,
  authHeader?: string,
  proxyBaseUrl?: string,
): Promise<void> {
  await executeSelect('SELECT * WHERE { ?s ?p ?o } LIMIT 1', {
    endpointUrl,
    authorizationHeader: authHeader,
    proxyBaseUrl,
  })
}

async function onSubmit() {
  if (!validate()) return

  connecting.value = true
  connectionError.value = ''

  const rawEndpoint = form.endpointUrl.trim()
  // If no proxy was typed, fall back to the directory entry's proxy (covers
  // the case where the user types a known CORS-restricted URL manually).
  const directoryProxy = ENDPOINT_DIRECTORY.find((e) => e.url === rawEndpoint)?.proxyUrl ?? ''
  const rawProxy = form.proxyUrl.trim() || directoryProxy
  let endpointUrl: string
  if (rawProxy && !(rawProxy.split('?')[0] ?? '').endsWith('/api/sparql')) {
    // Transparent proxy (e.g. Caddy): Comunica hits the proxy URL directly.
    endpointUrl = rawProxy
  } else {
    // No proxy or Vercel proxy: use the real endpoint. The connection store's
    // queryContext will inject proxyBaseUrl so the engine rewrites fetches.
    endpointUrl = rawEndpoint
  }
  try {
    connectingHost.value = new URL(rawEndpoint).hostname
  } catch {
    connectingHost.value = rawEndpoint
  }
  const authHeader = form.username.trim()
    ? `Basic ${btoa(`${form.username.trim()}:${form.password}`)}`
    : undefined
  const proxyPath = rawProxy.split('?')[0] ?? ''
  const proxyBaseUrl = proxyPath.endsWith('/api/sparql') ? proxyPath : undefined

  console.log('[SparqlForm] onSubmit', {
    rawEndpoint,
    rawProxy,
    endpointUrl,
    proxyPath,
    proxyBaseUrl,
  })

  try {
    // Skip the round-trip test when a cached schema already exists — the user
    // will see the cached nodes instantly, and Phase 2 will surface any
    // connectivity error if the endpoint is actually unreachable.
    const hasCachedSchema = loadSchema(endpointUrl) !== null
    if (!hasCachedSchema) {
      await testConnection(endpointUrl, authHeader, proxyBaseUrl)
    }

    schemaStore.clear()
    connectionStore.connectSparql({
      endpointUrl,
      username: form.username.trim(),
      password: form.password,
      proxyUrl: form.proxyUrl.trim(),
    })

    router.push({ name: 'browse' })
  } catch (err) {
    console.error('Connection test failed:', err)
    connectionError.value =
      err instanceof Error
        ? `Could not reach endpoint: ${err.message}`
        : 'Could not reach the SPARQL endpoint. Check the URL and try again.'
  } finally {
    connecting.value = false
  }
}
</script>

<style scoped>
.sparql-form {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-5);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
}

.field label {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-text);
}

.required {
  color: var(--rf-danger);
}

.fieldset-hint {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  margin: 0 0 var(--rf-space-4);
  line-height: var(--rf-leading-relaxed);
}

/* ── Collapsible sections ────────────────────────────────────────────────── */

.collapsible {
  border-top: 1px solid var(--rf-border);
  padding-top: var(--rf-space-3);
}

.collapsible-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--rf-space-2);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.collapsible-label {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.collapsible-toggle:hover .collapsible-label {
  color: var(--rf-primary);
}

.collapsible-badge {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-subtle);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  padding: 0.05rem 0.45rem;
  letter-spacing: 0.02em;
  font-weight: var(--rf-weight-normal);
}

.collapsible-chevron {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--rf-text-subtle);
  transition: color var(--rf-duration-fast) var(--rf-ease-out);
}

.collapsible-toggle:hover .collapsible-chevron {
  color: var(--rf-primary);
}

.collapsible-body {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-4);
  padding-top: var(--rf-space-4);
}

.collapse-enter-active,
.collapse-leave-active {
  transition: opacity var(--rf-duration-base) var(--rf-ease-out);
}
.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
}

.error-msg {
  color: var(--rf-danger);
  font-size: var(--rf-text-xs);
}

.connect-btn {
  margin-top: var(--rf-space-1);
}

/* ── Sample database cards ───────────────────────────────────────────────── */

.endpoint-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--rf-space-3);
}

@media (max-width: 480px) {
  .endpoint-grid {
    grid-template-columns: 1fr;
  }
}

.endpoint-card {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-1);
  padding: var(--rf-space-3) var(--rf-space-4);
  background: var(--rf-primary-soft);
  border: 1px solid color-mix(in srgb, var(--rf-primary) 25%, transparent);
  border-radius: var(--rf-radius-md);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--rf-duration-fast) var(--rf-ease-out),
    box-shadow var(--rf-duration-fast) var(--rf-ease-out);
}

.endpoint-card:hover:not(:disabled) {
  border-color: var(--rf-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rf-primary) 15%, transparent);
}

.endpoint-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.endpoint-card-name {
  font-size: var(--rf-text-sm);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-text);
}

.endpoint-card-domain {
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.endpoint-card-desc {
  font-size: var(--rf-text-xs);
  color: var(--rf-text-muted);
  line-height: var(--rf-leading-relaxed);
}

/* ── HTTPS notice ────────────────────────────────────────────────────────── */

.https-notice {
  color: var(--rf-success, #22c55e);
  font-size: var(--rf-text-xs);
  display: flex;
  align-items: center;
  gap: var(--rf-space-1);
}
</style>
