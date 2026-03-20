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

    <Fieldset legend="Authentication (optional)" :toggleable="true" collapsed>
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
    </Fieldset>

    <Fieldset legend="CORS Proxy (optional)" :toggleable="true" collapsed>
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
    </Fieldset>

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
import Fieldset from 'primevue/fieldset'
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
  gap: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-text-color);
}

.required {
  color: var(--p-red-500);
}

.fieldset-hint {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.error-msg {
  color: var(--p-red-500);
  font-size: 0.8rem;
}

.connect-btn {
  margin-top: 0.25rem;
}
</style>
