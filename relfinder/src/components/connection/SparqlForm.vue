<template>
  <form class="sparql-form" @submit.prevent="onSubmit">
    <div class="field">
      <label for="endpointUrl">SPARQL Endpoint URL <span class="required">*</span></label>
      <InputText
        id="endpointUrl"
        v-model="form.endpointUrl"
        placeholder="https://dbpedia.org/sparql"
        :invalid="!!errors.endpointUrl"
        fluid
        autocomplete="url"
      />
      <small v-if="errors.endpointUrl" class="error-msg">{{ errors.endpointUrl }}</small>
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
        <i :class="['pi', showProxy ? 'pi-chevron-up' : 'pi-chevron-down', 'collapsible-chevron']" />
      </button>
      <Transition name="collapse">
        <div v-show="showProxy" class="collapsible-body">
          <p class="fieldset-hint">
            Only needed when your SPARQL endpoint does not support cross-origin
            requests. Start the bundled Caddy proxy and enter its URL here.
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
      label="Connect"
      icon="pi pi-plug"
      :loading="connecting"
      fluid
      class="connect-btn"
    />

    <Message v-if="connectionError" severity="error" :closable="true" @close="connectionError = ''">
      {{ connectionError }}
    </Message>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useConnectionStore } from '@/stores/connection'
import { executeSelect } from '@/lib/sparql/engine'

const router = useRouter()
const connectionStore = useConnectionStore()

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
const connectionError = ref('')
const showAuth = ref(false)
const showProxy = ref(false)

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

// ── Connection ────────────────────────────────────────────────────────────────

/**
 * Fires a lightweight ASK query to verify the endpoint is reachable and
 * returns SPARQL results before committing to the connection store.
 */
async function testConnection(endpointUrl: string, authHeader?: string): Promise<void> {
  await executeSelect('SELECT * WHERE { ?s ?p ?o } LIMIT 1', {
    endpointUrl,
    authorizationHeader: authHeader,
  })
}

async function onSubmit() {
  if (!validate()) return

  connecting.value = true
  connectionError.value = ''

  const endpointUrl = form.proxyUrl.trim() || form.endpointUrl.trim()
  const authHeader =
    form.username.trim()
      ? `Basic ${btoa(`${form.username.trim()}:${form.password}`)}`
      : undefined

  try {
    await testConnection(endpointUrl, authHeader)

    connectionStore.connectSparql({
      endpointUrl,
      username: form.username.trim(),
      password: form.password,
      proxyUrl: form.proxyUrl.trim(),
    })

    router.push({ name: 'graph' })
  } catch (err) {
    console.error('Connection test failed:', err);
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
</style>
