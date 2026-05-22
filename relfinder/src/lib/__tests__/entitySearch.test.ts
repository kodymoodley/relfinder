// @vitest-environment node

/**
 * Unit tests for entitySearch.ts.
 *
 * Each function is tested against the user scenarios that drive it:
 *
 *   fetchInstancesByClass — the Browse view's class click handler loads instances;
 *     repeated clicks must hit the cache; unlabelled instances fall back to the IRI
 *     local name.
 *
 *   fetchEntityProps — the instance detail panel shows literal properties; when a
 *     predicate has no rdfs:label the IRI local name is used as a readable fallback.
 *
 *   searchEntities — the entity autocomplete fires on remote endpoints (restricted
 *     label predicates) and local stores (any string literal); class filter and text
 *     filter branches both exercised; duplicate IRIs are deduplicated.
 *
 *   fetchLabels / refreshGraphLabels — language-switch re-applies labels from the
 *     cached allLabels map without a new network round-trip; pickLabel priority is
 *     tested transitively (exact match → untagged → en → first available).
 *
 *   fetchTypes — ontology prefix filter keeps only types from the target namespace.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Store } from 'n3'
import {
  fetchInstancesByClass,
  fetchEntityProps,
  searchEntities,
  fetchLabels,
  fetchTypes,
  fetchDataProperties,
  refreshGraphLabels,
} from '@/lib/sparql/entitySearch'
import { executeSelect, executeSelectOnStore } from '@/lib/sparql/engine'
import { cacheInvalidate } from '@/lib/cache/queryCache'
import type { RelationshipGraph } from '@/lib/sparql/types'

vi.mock('@/lib/sparql/engine', () => ({
  executeSelect: vi.fn(),
  executeSelectOnStore: vi.fn(),
}))

const CTX = { endpointUrl: 'https://dbpedia.org/sparql' }

/** Helpers that produce minimal RDF.js-compatible Term objects */
function namedNode(value: string) {
  return { value, termType: 'NamedNode' }
}
function literal(value: string, lang = '') {
  return { value, lang, termType: 'Literal' }
}

beforeEach(() => {
  cacheInvalidate()
  vi.clearAllMocks()
})

// ── fetchInstancesByClass ─────────────────────────────────────────────────────

describe('fetchInstancesByClass', () => {
  it('returns instances with their rdfs:label when the endpoint provides one', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        s: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        label: literal('Cillian Murphy', 'en'),
      },
      {
        s: namedNode('http://dbpedia.org/resource/Emma_Thomas'),
        label: literal('Emma Thomas', 'en'),
      },
    ])

    const results = await fetchInstancesByClass('http://dbpedia.org/ontology/Actor', CTX)

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      iri: 'http://dbpedia.org/resource/Cillian_Murphy',
      label: 'Cillian Murphy',
    })
    expect(results[1]).toEqual({
      iri: 'http://dbpedia.org/resource/Emma_Thomas',
      label: 'Emma Thomas',
    })
  })

  it('falls back to the IRI local name when an instance has no label — custom vocab files still show something readable', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      { s: namedNode('http://example.org/resource/person_42') }, // no label binding
    ])

    const results = await fetchInstancesByClass('http://example.org/ontology/Person', CTX)

    expect(results[0].label).toBe('person_42')
  })

  it('returns the cached list on repeated calls — the Browse panel can open and close without re-fetching', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        s: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        label: literal('Cillian Murphy'),
      },
    ])

    await fetchInstancesByClass('http://dbpedia.org/ontology/Actor', CTX)
    await fetchInstancesByClass('http://dbpedia.org/ontology/Actor', CTX)

    expect(executeSelect).toHaveBeenCalledTimes(1)
  })

  it('uses executeSelectOnStore when a local N3 store is provided — no network call for uploaded files', async () => {
    vi.mocked(executeSelectOnStore).mockResolvedValue([
      { s: namedNode('http://example.org/Alice'), label: literal('Alice') },
    ])

    const results = await fetchInstancesByClass('http://example.org/Person', CTX, new Store())

    expect(executeSelectOnStore).toHaveBeenCalledTimes(1)
    expect(executeSelect).not.toHaveBeenCalled()
    expect(results[0].label).toBe('Alice')
  })

  it('deduplicates IRIs that appear in multiple bindings (e.g. entity has two matching label predicates)', async () => {
    const murphy = namedNode('http://dbpedia.org/resource/Cillian_Murphy')
    vi.mocked(executeSelect).mockResolvedValue([
      { s: murphy, label: literal('Cillian Murphy', 'en') },
      { s: murphy, label: literal('Cillian Murphy', 'en') }, // duplicate row
    ])

    const results = await fetchInstancesByClass('http://dbpedia.org/ontology/Actor', CTX)

    expect(results).toHaveLength(1)
  })
})

// ── fetchEntityProps ──────────────────────────────────────────────────────────

describe('fetchEntityProps', () => {
  it('returns the rdfs:label of each predicate when the endpoint provides one', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        p: namedNode('http://dbpedia.org/ontology/birthDate'),
        pLabel: literal('birth date'),
        o: literal('1976-05-21'),
      },
    ])

    const props = await fetchEntityProps('http://dbpedia.org/resource/Cillian_Murphy', CTX)

    expect(props).toHaveLength(1)
    expect(props[0].predLabel).toBe('birth date')
    expect(props[0].value).toBe('1976-05-21')
  })

  it('falls back to the IRI local name when the predicate has no rdfs:label — custom vocab still readable', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        p: namedNode('http://example.org/myVocab#hairColour'),
        // no pLabel binding
        o: literal('brown'),
      },
    ])

    const props = await fetchEntityProps('http://example.org/Alice', CTX)

    expect(props[0].predLabel).toBe('hairColour')
  })

  it('deduplicates rows with the same predicate+value so the panel does not show repeated entries', async () => {
    const p = namedNode('http://dbpedia.org/ontology/birthDate')
    const o = literal('1976-05-21')
    vi.mocked(executeSelect).mockResolvedValue([
      { p, pLabel: literal('birth date'), o },
      { p, pLabel: literal('birth date'), o }, // exact duplicate
    ])

    const props = await fetchEntityProps('http://dbpedia.org/resource/Cillian_Murphy', CTX)

    expect(props).toHaveLength(1)
  })

  it('uses executeSelectOnStore for local file uploads', async () => {
    vi.mocked(executeSelectOnStore).mockResolvedValue([
      { p: namedNode('http://example.org/name'), o: literal('Alice') },
    ])

    const props = await fetchEntityProps('http://example.org/Alice', CTX, new Store())

    expect(executeSelectOnStore).toHaveBeenCalledTimes(1)
    expect(props[0].predLabel).toBe('name') // shortIri fallback since no pLabel
  })
})

// ── searchEntities ────────────────────────────────────────────────────────────

describe('searchEntities', () => {
  it('queries the remote endpoint with a restricted label predicate list', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        s: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        label: literal('Cillian Murphy'),
        ctype: namedNode('http://dbpedia.org/ontology/Actor'),
      },
    ])

    const results = await searchEntities(CTX)

    expect(executeSelect).toHaveBeenCalledTimes(1)
    // Remote path uses VALUES clause for label predicates
    const query = vi.mocked(executeSelect).mock.calls[0][0]
    expect(query).toContain('VALUES ?lp')
    expect(results[0].label).toBe('Cillian Murphy')
  })

  it('generates a FILTER clause when allowedClasses is provided', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    await searchEntities(CTX, ['http://dbpedia.org/ontology/Actor'])

    const query = vi.mocked(executeSelect).mock.calls[0][0]
    expect(query).toContain('FILTER (?ctype IN')
    expect(query).toContain('<http://dbpedia.org/ontology/Actor>')
  })

  it('omits the class FILTER clause when allowedClasses is empty — unrestricted search', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    await searchEntities(CTX, [])

    const query = vi.mocked(executeSelect).mock.calls[0][0]
    expect(query).not.toContain('FILTER (?ctype IN')
  })

  it('adds a STRSTARTS text filter when textFilter is provided', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    await searchEntities(CTX, [], undefined, 50, 'nolan')

    const query = vi.mocked(executeSelect).mock.calls[0][0]
    expect(query).toContain('STRSTARTS')
    expect(query).toContain('nolan')
  })

  it('uses the any-literal local-store query path when a store is provided', async () => {
    vi.mocked(executeSelectOnStore).mockResolvedValue([])

    await searchEntities(CTX, [], new Store())

    expect(executeSelectOnStore).toHaveBeenCalledTimes(1)
    // Local path scans any string literal predicate
    const query = vi.mocked(executeSelectOnStore).mock.calls[0][0]
    expect(query).toContain('isLiteral(?label)')
  })

  it('deduplicates entities that appear with multiple label predicates', async () => {
    const murphy = namedNode('http://dbpedia.org/resource/Cillian_Murphy')
    const actor = namedNode('http://dbpedia.org/ontology/Actor')
    vi.mocked(executeSelect).mockResolvedValue([
      { s: murphy, label: literal('Cillian Murphy'), ctype: actor },
      { s: murphy, label: literal('Cillian Murphy', 'en'), ctype: actor }, // same IRI, second label
    ])

    const results = await searchEntities(CTX)

    expect(results).toHaveLength(1)
  })
})

// ── fetchLabels ───────────────────────────────────────────────────────────────

describe('fetchLabels', () => {
  it('returns an empty map immediately when called with an empty IRI list', async () => {
    const map = await fetchLabels([], CTX)

    expect(map.size).toBe(0)
    expect(executeSelect).not.toHaveBeenCalled()
  })

  it('groups all language variants of a label under the same IRI key', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        p: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        label: literal('Cillian Murphy', 'en'),
      },
      {
        p: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        label: literal('Cillian Murphy', 'fr'),
      },
    ])

    const map = await fetchLabels(['http://dbpedia.org/resource/Cillian_Murphy'], CTX)

    const entries = map.get('http://dbpedia.org/resource/Cillian_Murphy')
    expect(entries).toHaveLength(2)
    expect(entries?.map((e) => e.lang)).toEqual(['en', 'fr'])
  })
})

// ── fetchTypes ────────────────────────────────────────────────────────────────

describe('fetchTypes', () => {
  it('returns an empty map immediately when called with an empty IRI list', async () => {
    const map = await fetchTypes([], CTX)

    expect(map.size).toBe(0)
    expect(executeSelect).not.toHaveBeenCalled()
  })

  it('accepts types from any namespace when ontologyPrefix is empty', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        o: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        type: namedNode('http://schema.org/Person'),
      },
    ])

    const map = await fetchTypes(['http://dbpedia.org/resource/Cillian_Murphy'], CTX, '')

    expect(map.get('http://dbpedia.org/resource/Cillian_Murphy')).toBe('http://schema.org/Person')
  })

  it('filters out types that do not match the ontology prefix', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        o: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        type: namedNode('http://schema.org/Person'),
      }, // wrong namespace
      {
        o: namedNode('http://dbpedia.org/resource/Cillian_Murphy'),
        type: namedNode('http://dbpedia.org/ontology/Actor'),
      }, // correct
    ])

    const map = await fetchTypes(
      ['http://dbpedia.org/resource/Cillian_Murphy'],
      CTX,
      'http://dbpedia.org/ontology/',
    )

    expect(map.get('http://dbpedia.org/resource/Cillian_Murphy')).toBe(
      'http://dbpedia.org/ontology/Actor',
    )
  })
})

// ── refreshGraphLabels (tests pickLabel priority transitively) ────────────────

describe('refreshGraphLabels', () => {
  const baseGraph = (): RelationshipGraph => ({
    nodes: [
      {
        id: 1,
        iri: 'http://dbpedia.org/resource/Oppenheimer',
        label: 'Oppenheimer',
        class: 'http://dbpedia.org/ontology/Film',
        isEndpoint: false,
      },
    ],
    edges: [{ sid: 1, tid: 2, iris: ['http://dbpedia.org/ontology/director'], label: 'director' }],
    classes: [],
    allLabels: new Map([
      [
        'http://dbpedia.org/resource/Oppenheimer',
        [
          { value: 'Oppenheimer', lang: 'en' },
          { value: 'Oppenheimer (film)', lang: 'fr' },
        ],
      ],
      [
        'http://dbpedia.org/ontology/director',
        [
          { value: 'director', lang: 'en' },
          { value: 'réalisateur', lang: 'fr' },
        ],
      ],
    ]),
  })

  it('applies the exact language match when available', () => {
    const graph = baseGraph()

    refreshGraphLabels(graph, 'fr')

    expect(graph.nodes[0].label).toBe('Oppenheimer (film)')
    expect(graph.edges[0].label).toBe('réalisateur')
  })

  it('keeps the existing label unchanged when the IRI has no entry in allLabels', () => {
    const graph = baseGraph()
    graph.nodes[0].iri = 'http://dbpedia.org/resource/Unknown' // not in allLabels

    refreshGraphLabels(graph, 'en')

    expect(graph.nodes[0].label).toBe('Oppenheimer') // unchanged
  })

  it('falls back to the English label when the requested language has no match', () => {
    const graph = baseGraph()
    // allLabels has 'en' and 'fr', but not 'de'
    refreshGraphLabels(graph, 'de')

    // pickLabel: no 'de' exact, no untagged, language !== 'en' → tries 'en' fallback
    expect(graph.nodes[0].label).toBe('Oppenheimer')
  })

  it('uses an untagged literal before falling back to English', () => {
    const graph = baseGraph()
    graph.allLabels.set('http://dbpedia.org/resource/Oppenheimer', [
      { value: 'Oppenheimer plain', lang: '' }, // untagged
      { value: 'Oppenheimer', lang: 'en' },
    ])

    refreshGraphLabels(graph, 'de') // no 'de' match → untagged wins over 'en'

    expect(graph.nodes[0].label).toBe('Oppenheimer plain')
  })

  it('skips the exact-language check when language is empty — falls through to the untagged entry', () => {
    // pickLabel: if(language) is false when language='', skip exact match, find untagged
    const graph = baseGraph()
    graph.allLabels.set('http://dbpedia.org/resource/Oppenheimer', [
      { value: 'Oppenheimer plain', lang: '' },
      { value: 'Oppenheimer', lang: 'en' },
    ])

    refreshGraphLabels(graph, '')

    expect(graph.nodes[0].label).toBe('Oppenheimer plain')
  })

  it("returns the first available entry when language is 'en' and there is no 'en' label", () => {
    // pickLabel: language='en', no exact 'en', no untagged → if(language !== 'en') is false → entries[0]
    const graph = baseGraph()
    graph.allLabels.set('http://dbpedia.org/resource/Oppenheimer', [
      { value: 'Oppenheimer auf Deutsch', lang: 'de' },
    ])

    refreshGraphLabels(graph, 'en')

    expect(graph.nodes[0].label).toBe('Oppenheimer auf Deutsch')
  })
})

// ── fetchDataProperties ───────────────────────────────────────────────────────

describe('fetchDataProperties', () => {
  it('returns an empty array when the endpoint has no data properties for the entity', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    const props = await fetchDataProperties('http://dbpedia.org/resource/Cillian_Murphy', CTX)

    expect(props).toHaveLength(0)
  })

  it('returns labelled literal properties for an entity', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      {
        p: namedNode('http://dbpedia.org/ontology/birthDate'),
        propLabel: literal('birth date', 'en'),
        propValue: literal('1976-05-21'),
      },
    ])

    const props = await fetchDataProperties('http://dbpedia.org/resource/Cillian_Murphy', CTX)

    expect(props).toHaveLength(1)
    expect(props[0]!.iri).toBe('http://dbpedia.org/ontology/birthDate')
    expect(props[0]!.label).toBe('birth date')
    expect(props[0]!.value).toBe('1976-05-21')
  })

  it('deduplicates rows with the same predicate — keeps only the first occurrence', async () => {
    const p = namedNode('http://dbpedia.org/ontology/birthDate')
    vi.mocked(executeSelect).mockResolvedValue([
      { p, propLabel: literal('birth date', 'en'), propValue: literal('1976-05-21') },
      { p, propLabel: literal('birth date', 'en'), propValue: literal('1976-05-21') },
    ])

    const props = await fetchDataProperties('http://dbpedia.org/resource/Cillian_Murphy', CTX)

    expect(props).toHaveLength(1)
  })

  it('uses executeSelectOnStore for local file uploads — no network call', async () => {
    vi.mocked(executeSelectOnStore).mockResolvedValue([
      {
        p: namedNode('http://example.org/name'),
        propLabel: literal('name', 'en'),
        propValue: literal('Alice'),
      },
    ])

    const props = await fetchDataProperties('http://example.org/Alice', CTX, 50, new Store())

    expect(executeSelectOnStore).toHaveBeenCalledTimes(1)
    expect(executeSelect).not.toHaveBeenCalled()
    expect(props[0]!.label).toBe('name')
  })

  it('skips rows that are missing predicate, propLabel, or propValue bindings', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      { p: namedNode('http://example.org/name') }, // missing propLabel and propValue
    ])

    const props = await fetchDataProperties('http://example.org/Alice', CTX)

    expect(props).toHaveLength(0)
  })
})
