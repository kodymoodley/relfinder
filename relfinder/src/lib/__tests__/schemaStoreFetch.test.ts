// @vitest-environment jsdom

/**
 * Unit tests for the schema store's four per-item fetch actions:
 *   fetchDataProps, fetchDescription, fetchInstances, fetchEntityPropsForInstance
 *
 * Each action follows the same guard pattern the UI depends on:
 *   1. Cache hit  → return immediately, no second network call
 *   2. In-flight  → return immediately, no duplicate request
 *   3. Normal     → fetch, populate cache, clear loading state
 *
 * Also covers the loadMore() error path, which is separate from start()'s
 * error handling and not exercised in schemaState.test.ts.
 *
 * fetchSchemaDataProperties, fetchClassDescription, fetchInstancesByClass, and
 * fetchEntityProps are mocked; no SPARQL endpoint is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSchemaStore } from '@/stores/schema'
import { fetchSchemaDataProperties } from '@/lib/sparql/schemaExtractor'
import { fetchClassDescription } from '@/lib/sparql/classDescription'
import { fetchInstancesByClass, fetchEntityProps } from '@/lib/sparql/entitySearch'
import { extractSchema } from '@/lib/sparql/schemaExtractor'

vi.mock('@/lib/sparql/schemaExtractor', () => ({
  extractSchema: vi.fn(),
  fetchSchemaDataProperties: vi.fn(),
}))

vi.mock('@/lib/sparql/classDescription', () => ({
  fetchClassDescription: vi.fn(),
}))

vi.mock('@/lib/sparql/entitySearch', () => ({
  fetchInstancesByClass: vi.fn(),
  fetchEntityProps: vi.fn(),
}))

const CTX = { endpointUrl: 'https://dbpedia.org/sparql' }
const ACTOR_CLASS = 'http://dbpedia.org/ontology/Actor'
const MURPHY_IRI = 'http://dbpedia.org/resource/Cillian_Murphy'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ── fetchDataProps ────────────────────────────────────────────────────────────

describe('fetchDataProps', () => {
  it('fetches data properties and stores them in the cache', async () => {
    const props = [
      {
        iri: 'http://dbpedia.org/ontology/birthDate',
        label: 'birth date',
        datatypes: ['date'],
      },
    ]
    vi.mocked(fetchSchemaDataProperties).mockResolvedValue(props)

    const store = useSchemaStore()
    await store.fetchDataProps(ACTOR_CLASS, CTX, undefined)

    expect(store.dataPropsCache.get(ACTOR_CLASS)).toEqual(props)
  })

  it('skips the fetch on a cache hit — repeated panel opens do not re-query the endpoint', async () => {
    vi.mocked(fetchSchemaDataProperties).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchDataProps(ACTOR_CLASS, CTX, undefined)
    await store.fetchDataProps(ACTOR_CLASS, CTX, undefined) // second call — cache hit

    expect(fetchSchemaDataProperties).toHaveBeenCalledTimes(1)
  })

  it('clears the loading indicator after the fetch completes', async () => {
    vi.mocked(fetchSchemaDataProperties).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchDataProps(ACTOR_CLASS, CTX, undefined)

    expect(store.dataPropsLoading.has(ACTOR_CLASS)).toBe(false)
  })

  it('clears the loading indicator even when the fetch throws', async () => {
    vi.mocked(fetchSchemaDataProperties).mockRejectedValue(new Error('endpoint timeout'))

    const store = useSchemaStore()
    await store.fetchDataProps(ACTOR_CLASS, CTX, undefined).catch(() => {})

    expect(store.dataPropsLoading.has(ACTOR_CLASS)).toBe(false)
  })

  it('does not fire a second request while the first is still in-flight', async () => {
    let resolve!: (v: []) => void
    vi.mocked(fetchSchemaDataProperties).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    const store = useSchemaStore()
    const first = store.fetchDataProps(ACTOR_CLASS, CTX, undefined)
    const second = store.fetchDataProps(ACTOR_CLASS, CTX, undefined) // duplicate — in-flight guard

    resolve([])
    await Promise.all([first, second])

    expect(fetchSchemaDataProperties).toHaveBeenCalledTimes(1)
  })
})

// ── fetchDescription ──────────────────────────────────────────────────────────

describe('fetchDescription', () => {
  it('fetches the class description and stores it in the cache', async () => {
    vi.mocked(fetchClassDescription).mockResolvedValue('Actors are people who perform in films.')

    const store = useSchemaStore()
    await store.fetchDescription(ACTOR_CLASS, CTX, undefined)

    expect(store.descriptionCache.get(ACTOR_CLASS)).toBe('Actors are people who perform in films.')
  })

  it('stores an empty string so classes with no description are not re-fetched', async () => {
    vi.mocked(fetchClassDescription).mockResolvedValue('')

    const store = useSchemaStore()
    await store.fetchDescription(ACTOR_CLASS, CTX, undefined)

    expect(store.descriptionCache.has(ACTOR_CLASS)).toBe(true)
    expect(store.descriptionCache.get(ACTOR_CLASS)).toBe('')
  })

  it('skips the fetch on a cache hit', async () => {
    vi.mocked(fetchClassDescription).mockResolvedValue('Some description')

    const store = useSchemaStore()
    await store.fetchDescription(ACTOR_CLASS, CTX, undefined)
    await store.fetchDescription(ACTOR_CLASS, CTX, undefined)

    expect(fetchClassDescription).toHaveBeenCalledTimes(1)
  })

  it('clears the loading indicator after completion', async () => {
    vi.mocked(fetchClassDescription).mockResolvedValue('')

    const store = useSchemaStore()
    await store.fetchDescription(ACTOR_CLASS, CTX, undefined)

    expect(store.descriptionLoading.has(ACTOR_CLASS)).toBe(false)
  })

  it('does not fire a second request while the first is still in-flight', async () => {
    let resolve!: (v: string) => void
    vi.mocked(fetchClassDescription).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    const store = useSchemaStore()
    const first = store.fetchDescription(ACTOR_CLASS, CTX, undefined)
    const second = store.fetchDescription(ACTOR_CLASS, CTX, undefined)

    resolve('description text')
    await Promise.all([first, second])

    expect(fetchClassDescription).toHaveBeenCalledTimes(1)
  })
})

// ── fetchInstances ────────────────────────────────────────────────────────────

describe('fetchInstances', () => {
  it('fetches instances and stores them in the cache', async () => {
    const instances = [{ iri: MURPHY_IRI, label: 'Cillian Murphy' }]
    vi.mocked(fetchInstancesByClass).mockResolvedValue(instances)

    const store = useSchemaStore()
    await store.fetchInstances(ACTOR_CLASS, CTX, undefined)

    expect(store.instancesCache.get(ACTOR_CLASS)).toEqual(instances)
  })

  it('skips the fetch on a cache hit — clicking the same class node twice is free', async () => {
    vi.mocked(fetchInstancesByClass).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchInstances(ACTOR_CLASS, CTX, undefined)
    await store.fetchInstances(ACTOR_CLASS, CTX, undefined)

    expect(fetchInstancesByClass).toHaveBeenCalledTimes(1)
  })

  it('clears the loading indicator after completion', async () => {
    vi.mocked(fetchInstancesByClass).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchInstances(ACTOR_CLASS, CTX, undefined)

    expect(store.instancesLoading.has(ACTOR_CLASS)).toBe(false)
  })

  it('does not fire a second request while the first is still in-flight', async () => {
    let resolve!: (v: []) => void
    vi.mocked(fetchInstancesByClass).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    const store = useSchemaStore()
    const first = store.fetchInstances(ACTOR_CLASS, CTX, undefined)
    const second = store.fetchInstances(ACTOR_CLASS, CTX, undefined)

    resolve([])
    await Promise.all([first, second])

    expect(fetchInstancesByClass).toHaveBeenCalledTimes(1)
  })
})

// ── fetchEntityPropsForInstance ───────────────────────────────────────────────

describe('fetchEntityPropsForInstance', () => {
  it('fetches entity props and stores them in the cache', async () => {
    const props = [
      {
        predIri: 'http://dbpedia.org/ontology/birthDate',
        predLabel: 'birth date',
        value: '1976-05-21',
      },
    ]
    vi.mocked(fetchEntityProps).mockResolvedValue(props)

    const store = useSchemaStore()
    await store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)

    expect(store.entityPropsCache.get(MURPHY_IRI)).toEqual(props)
  })

  it('skips the fetch on a cache hit — expanding the detail panel twice does not double-fetch', async () => {
    vi.mocked(fetchEntityProps).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)
    await store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)

    expect(fetchEntityProps).toHaveBeenCalledTimes(1)
  })

  it('clears the loading indicator after completion', async () => {
    vi.mocked(fetchEntityProps).mockResolvedValue([])

    const store = useSchemaStore()
    await store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)

    expect(store.entityPropsLoading.has(MURPHY_IRI)).toBe(false)
  })

  it('does not fire a second request while the first is still in-flight', async () => {
    let resolve!: (v: []) => void
    vi.mocked(fetchEntityProps).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    const store = useSchemaStore()
    const first = store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)
    const second = store.fetchEntityPropsForInstance(MURPHY_IRI, CTX, undefined)

    resolve([])
    await Promise.all([first, second])

    expect(fetchEntityProps).toHaveBeenCalledTimes(1)
  })
})

// ── loadMore() error path ─────────────────────────────────────────────────────

describe('loadMore() error handling', () => {
  /** Helper: run start() so _context is stored, enabling loadMore() */
  async function connectStore(store: ReturnType<typeof useSchemaStore>) {
    vi.mocked(extractSchema).mockResolvedValue({ nodes: [], edges: [] } as never)
    await store.start(CTX, undefined, 10, 3)
  }

  it('sets extractError when loadMore throws a non-abort error', async () => {
    const store = useSchemaStore()
    await connectStore(store)

    vi.mocked(extractSchema).mockRejectedValue(new Error('quota exceeded'))
    await store.loadMore()

    expect(store.extractError).toBe('Extraction failed: quota exceeded')
  })

  it('does not set extractError when loadMore is aborted', async () => {
    const store = useSchemaStore()
    await connectStore(store)

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.mocked(extractSchema).mockRejectedValue(abortErr)
    await store.loadMore()

    expect(store.extractError).toBe('')
  })

  it('clears the extracting flag after a loadMore error', async () => {
    const store = useSchemaStore()
    await connectStore(store)

    vi.mocked(extractSchema).mockRejectedValue(new Error('network error'))
    await store.loadMore()

    expect(store.extracting).toBe(false)
  })
})
