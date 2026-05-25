import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SchemaNode, SchemaEdge } from '../sparql/types'

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before the module under test is imported so Vitest hoists
// them above the import statements.

vi.mock('../search/entityCache', () => ({
  cacheAdd: vi.fn(),
  cacheHas: vi.fn(() => false),
}))

import { bootstrapFromSchema } from '../search/coldStartBootstrap'
import { cacheAdd, cacheHas } from '../search/entityCache'

const mockedCacheAdd = vi.mocked(cacheAdd)
const mockedCacheHas = vi.mocked(cacheHas)

// ── Constants mirrored from the module under test ─────────────────────────────

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNode(iri: string, label: string): SchemaNode {
  return { iri, label }
}

function makeEdge(
  sourceIri: string,
  targetIri: string,
  props: Array<{ iri: string; label: string }>,
): SchemaEdge {
  return {
    sourceIri,
    targetIri,
    props: props.map((p) => ({ ...p, count: 1 })),
    totalCount: props.length,
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockedCacheHas.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bootstrapFromSchema', () => {
  it('adds schema classes with OWL_CLASS classIri', () => {
    const nodes = [makeNode('http://e.org/Person', 'Person')]
    bootstrapFromSchema(nodes, [], new Map())
    vi.runAllTimers()

    expect(mockedCacheAdd).toHaveBeenCalledOnce()
    const [entities] = mockedCacheAdd.mock.calls[0]!
    const person = entities.find((e) => e.iri === 'http://e.org/Person')
    expect(person?.classIri).toBe(OWL_CLASS)
    expect(person?.classLabel).toBe('Class')
    expect(person?.label).toBe('Person')
  })

  it('adds object properties with OWL_OBJECT_PROPERTY classIri', () => {
    const edges = [
      makeEdge('http://e.org/A', 'http://e.org/B', [{ iri: 'http://e.org/knows', label: 'knows' }]),
    ]
    bootstrapFromSchema([], edges, new Map())
    vi.runAllTimers()

    const [entities] = mockedCacheAdd.mock.calls[0]!
    const prop = entities.find((e) => e.iri === 'http://e.org/knows')
    expect(prop?.classIri).toBe(OWL_OBJECT_PROPERTY)
    expect(prop?.classLabel).toBe('Object Property')
    expect(prop?.label).toBe('knows')
  })

  it('deduplicates properties that appear on multiple edges', () => {
    const edges = [
      makeEdge('http://e.org/A', 'http://e.org/B', [{ iri: 'http://e.org/rel', label: 'rel' }]),
      makeEdge('http://e.org/B', 'http://e.org/C', [{ iri: 'http://e.org/rel', label: 'rel' }]),
    ]
    bootstrapFromSchema([], edges, new Map())
    vi.runAllTimers()

    const [entities] = mockedCacheAdd.mock.calls[0]!
    expect(entities.filter((e) => e.iri === 'http://e.org/rel')).toHaveLength(1)
  })

  it('adds instances with the correct classIri and classLabel', () => {
    const nodes = [makeNode('http://e.org/Person', 'Person')]
    const instancesCache = new Map([
      ['http://e.org/Person', [{ iri: 'http://e.org/Alice', label: 'Alice' }]],
    ])
    bootstrapFromSchema(nodes, [], instancesCache)
    vi.runAllTimers()

    const [entities] = mockedCacheAdd.mock.calls[0]!
    const alice = entities.find((e) => e.iri === 'http://e.org/Alice')
    expect(alice?.classIri).toBe('http://e.org/Person')
    expect(alice?.classLabel).toBe('Person')
    expect(alice?.label).toBe('Alice')
  })

  it('uses "Unknown" classLabel for instances whose class is not in nodes', () => {
    const instancesCache = new Map([
      ['http://e.org/OrphanClass', [{ iri: 'http://e.org/Inst', label: 'Inst' }]],
    ])
    bootstrapFromSchema([], [], instancesCache)
    vi.runAllTimers()

    const [entities] = mockedCacheAdd.mock.calls[0]!
    expect(entities[0]?.classLabel).toBe('Unknown')
  })

  it('skips entities already present in the cache', () => {
    mockedCacheHas.mockReturnValue(true)
    const nodes = [makeNode('http://e.org/Person', 'Person')]
    bootstrapFromSchema(nodes, [], new Map())
    vi.runAllTimers()

    expect(mockedCacheAdd).not.toHaveBeenCalled()
  })

  it('is a no-op when all inputs are empty', () => {
    bootstrapFromSchema([], [], new Map())
    vi.runAllTimers()

    expect(mockedCacheAdd).not.toHaveBeenCalled()
  })

  it('calls cacheAdd synchronously for the first chunk without waiting for idle callbacks', () => {
    const nodes = [makeNode('http://e.org/Person', 'Person')]
    bootstrapFromSchema(nodes, [], new Map())

    // First chunk runs synchronously — cacheAdd is already called before any timer fires.
    expect(mockedCacheAdd).toHaveBeenCalledOnce()
  })

  it('splits large entity lists into CHUNK_SIZE batches', () => {
    const nodes = Array.from({ length: 1100 }, (_, i) =>
      makeNode(`http://e.org/C${i}`, `Class${i}`),
    )
    bootstrapFromSchema(nodes, [], new Map())
    vi.runAllTimers()

    // 1100 entities → chunks of 500: [500, 500, 100] = 3 calls
    expect(mockedCacheAdd).toHaveBeenCalledTimes(3)
    const allEntities = mockedCacheAdd.mock.calls.flatMap((c) => c[0]!)
    expect(allEntities).toHaveLength(1100)
  })

  it('populates addedAt and lastAccessed on every entity', () => {
    const before = Date.now()
    const nodes = [makeNode('http://e.org/A', 'A')]
    bootstrapFromSchema(nodes, [], new Map())
    vi.runAllTimers()

    const [entities] = mockedCacheAdd.mock.calls[0]!
    expect(entities[0]?.addedAt).toBeGreaterThanOrEqual(before)
    expect(entities[0]?.lastAccessed).toBeGreaterThanOrEqual(before)
  })
})
