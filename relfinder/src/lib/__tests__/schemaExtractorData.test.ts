// @vitest-environment node

/**
 * Targeted tests for the three uncovered branches in schemaExtractor.ts:
 *
 *   Phase 1 empty result  (line ~61)
 *     When the endpoint returns no classes, extractSchema returns immediately
 *     without firing Phase 2 queries or triggering any callbacks.
 *
 *   Empty Phase 2 queue  (line ~273)
 *     When every node is already in skipClasses, the queue is empty and
 *     extractSchema returns without any edge queries.
 *
 *   fetchSchemaDataProperties  (lines ~322-349)
 *     Used by the schema panel to list the literal properties of a class.
 *     Covers: normal fetch, missing datatype, dedup across rows, onStatus
 *     callback with singular/plural messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractSchema, fetchSchemaDataProperties } from '@/lib/sparql/schemaExtractor'
import { executeSelect } from '@/lib/sparql/engine'
import { fetchLabels } from '@/lib/sparql/entitySearch'
import type { SchemaNode } from '@/lib/sparql/types'
import type { SchemaExtractionCallbacks } from '@/lib/sparql/schemaExtractor'
import { SparqlClient } from '@/lib/sparql/client'

vi.mock('@/lib/sparql/engine', () => {
  const executeSelect = vi.fn()
  const executeSelectOnStore = vi.fn().mockResolvedValue([])
  const runSelect = vi.fn((q: string, ctx: unknown, store?: unknown) =>
    store ? executeSelectOnStore(q, store) : executeSelect(q, ctx),
  )
  return { executeSelect, executeSelectOnStore, runSelect }
})

vi.mock('@/lib/sparql/entitySearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sparql/entitySearch')>()
  return { ...actual, fetchLabels: vi.fn().mockResolvedValue(new Map()) }
})

const CTX = { endpointUrl: 'https://example.org/sparql' }
const CLIENT = new SparqlClient(CTX)
const NODES: SchemaNode[] = [
  { iri: 'http://example.org/A', label: 'A' },
  { iri: 'http://example.org/B', label: 'B' },
]

function makeCallbacks(): SchemaExtractionCallbacks {
  return {
    onClassesLoaded: vi.fn(),
    onEdgesLoaded: vi.fn(),
    onProgress: vi.fn(),
    onClassProcessed: vi.fn(),
    onDescriptionsLoaded: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

// ── Phase 1: empty endpoint ───────────────────────────────────────────────────

describe('extractSchema — Phase 1 returns no classes', () => {
  it('returns an empty graph without calling any callbacks', async () => {
    // Phase 1 class discovery returns nothing
    vi.mocked(executeSelect).mockResolvedValue([])

    const cbs = makeCallbacks()
    const result = await extractSchema(CLIENT, {}, cbs)

    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    expect(cbs.onClassesLoaded).not.toHaveBeenCalled()
    expect(cbs.onProgress).not.toHaveBeenCalled()
  })

  it('fires no Phase 2 edge queries when Phase 1 is empty', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    await extractSchema(CLIENT, {}, makeCallbacks())

    // Only the Phase 1 class query should have fired — no edge queries
    expect(executeSelect).toHaveBeenCalledTimes(1)
  })

  it('discovers classes when the endpoint returns results and calls onClassesLoaded', async () => {
    vi.mocked(executeSelect)
      // Phase 1: class discovery
      .mockResolvedValueOnce([
        { class: { value: 'http://example.org/A', type: 'NamedNode' } },
        { class: { value: 'http://example.org/B', type: 'NamedNode' } },
      ])
      // All subsequent calls (descriptions, Phase 2 edges): empty
      .mockResolvedValue([])

    const cbs = makeCallbacks()
    const result = await extractSchema(CLIENT, {}, cbs)

    expect(result.nodes).toHaveLength(2)
    expect(cbs.onClassesLoaded).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ iri: 'http://example.org/A' }),
        expect.objectContaining({ iri: 'http://example.org/B' }),
      ]),
    )
  })
})

// ── Phase 2: queue empty (all nodes already skipped) ─────────────────────────

describe('extractSchema — all nodes in skipClasses', () => {
  it('returns without firing any edge queries when every class is already processed', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    const cbs = makeCallbacks()
    await extractSchema(
      CLIENT,
      { preloadedNodes: NODES, skipClasses: new Set(NODES.map((n) => n.iri)) },
      cbs,
    )

    expect(executeSelect).not.toHaveBeenCalled()
    expect(cbs.onProgress).not.toHaveBeenCalled()
    expect(cbs.onEdgesLoaded).not.toHaveBeenCalled()
  })

  it('returns the preloaded nodes unchanged', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    const result = await extractSchema(CLIENT, {
      preloadedNodes: NODES,
      skipClasses: new Set(NODES.map((n) => n.iri)),
    })

    expect(result.nodes).toEqual(NODES)
    expect(result.edges).toHaveLength(0)
  })
})

// ── fetchSchemaDataProperties ─────────────────────────────────────────────────

describe('fetchSchemaDataProperties', () => {
  const CLASS_IRI = 'http://dbpedia.org/ontology/Actor'
  const NAME_PROP = 'http://dbpedia.org/property/name'
  const DATE_PROP = 'http://dbpedia.org/ontology/birthDate'
  const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
  const XSD_DATE = 'http://www.w3.org/2001/XMLSchema#date'

  it('returns an empty array when the class has no literal properties', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    const props = await fetchSchemaDataProperties(CLASS_IRI, CLIENT)

    expect(props).toHaveLength(0)
  })

  it('returns each distinct property with its label and datatype', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        prop: { value: NAME_PROP, type: 'NamedNode' },
        dt: { value: XSD_STRING, type: 'NamedNode' },
      },
    ])

    const props = await fetchSchemaDataProperties(CLASS_IRI, CLIENT)

    expect(props).toHaveLength(1)
    expect(props[0]!.iri).toBe(NAME_PROP)
    expect(props[0]!.label).toBe('name') // shortIri of NAME_PROP
    expect(props[0]!.datatypes).toContain('string') // shortIri of XSD_STRING
  })

  it('groups multiple datatypes under one property entry', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      { prop: { value: DATE_PROP, type: 'NamedNode' }, dt: { value: XSD_DATE, type: 'NamedNode' } },
      {
        prop: { value: DATE_PROP, type: 'NamedNode' },
        dt: { value: XSD_STRING, type: 'NamedNode' },
      },
    ])

    const props = await fetchSchemaDataProperties(CLASS_IRI, CLIENT)

    expect(props).toHaveLength(1)
    expect(props[0]!.datatypes).toHaveLength(2)
    expect(props[0]!.datatypes).toContain('date')
    expect(props[0]!.datatypes).toContain('string')
  })

  it('omits empty datatype strings — untyped literals do not pollute the datatypes list', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      { prop: { value: NAME_PROP, type: 'NamedNode' } }, // no dt binding at all
    ])

    const props = await fetchSchemaDataProperties(CLASS_IRI, CLIENT)

    expect(props[0]!.datatypes).toEqual([])
  })

  it('calls onStatus twice — once after the query, once after processing', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        prop: { value: NAME_PROP, type: 'NamedNode' },
        dt: { value: XSD_STRING, type: 'NamedNode' },
      },
    ])
    const onStatus = vi.fn()

    await fetchSchemaDataProperties(CLASS_IRI, CLIENT, 50, onStatus)

    expect(onStatus).toHaveBeenCalledTimes(2)
  })

  it('uses plural form in onStatus messages when there are multiple rows or properties', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        prop: { value: NAME_PROP, type: 'NamedNode' },
        dt: { value: XSD_STRING, type: 'NamedNode' },
      },
      { prop: { value: DATE_PROP, type: 'NamedNode' }, dt: { value: XSD_DATE, type: 'NamedNode' } },
    ])
    const onStatus = vi.fn()

    await fetchSchemaDataProperties(CLASS_IRI, CLIENT, 50, onStatus)

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('rows')) // plural
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('properties')) // plural
  })

  it('uses singular form in onStatus messages when there is exactly one row and one property', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        prop: { value: NAME_PROP, type: 'NamedNode' },
        dt: { value: XSD_STRING, type: 'NamedNode' },
      },
    ])
    const onStatus = vi.fn()

    await fetchSchemaDataProperties(CLASS_IRI, CLIENT, 50, onStatus)

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('row')) // singular
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('property')) // singular
  })

  it('works without an onStatus callback — no error when omitted', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    await expect(fetchSchemaDataProperties(CLASS_IRI, CLIENT)).resolves.toEqual([])
  })
})

// ── Phase 1 label assignment (lines 253-261) ──────────────────────────────────

describe('extractSchema — Phase 1 label assignment from fetchLabels', () => {
  it('applies the best label to a class node when fetchLabels returns entries', async () => {
    vi.mocked(executeSelect)
      .mockResolvedValueOnce([{ class: { value: 'http://example.org/A', type: 'NamedNode' } }])
      .mockResolvedValue([]) // descriptions + Phase 2 edges: empty

    // Override the default empty-Map return just for this call
    vi.mocked(fetchLabels).mockResolvedValueOnce(
      new Map([['http://example.org/A', [{ value: 'Class A', lang: 'en' }]]]),
    )

    const result = await extractSchema(CLIENT, {})

    expect(result.nodes[0]!.label).toBe('Class A')
  })
})

// ── additionalClassIris branch (line 272-273) ─────────────────────────────────

describe('extractSchema — additionalClassIris option', () => {
  it('uses additionalClassIris to expand the edge-query class set without re-processing them', async () => {
    vi.mocked(executeSelect)
      .mockResolvedValueOnce([{ class: { value: 'http://example.org/A', type: 'NamedNode' } }])
      .mockResolvedValue([]) // descriptions + Phase 2 edges: empty

    const result = await extractSchema(CLIENT, {
      additionalClassIris: ['http://example.org/PriorClass'],
    })

    // The function takes the true branch for additionalClassIris and returns normally
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]!.iri).toBe('http://example.org/A')
  })
})
