// @vitest-environment node

/**
 * Unit tests for fetchClassDescription.
 *
 * The Schema Browse panel shows a one-paragraph description below each class
 * node. This function fetches candidates from multiple RDF description
 * properties in one query, then selects the best match client-side.
 *
 * Scenarios tested:
 *   - No description found → returns '' so the panel shows nothing
 *   - rdfs:comment wins over lower-priority properties (skos:definition, etc.)
 *   - Language priority: exact match → English → untagged → first available
 *   - File upload path uses executeSelectOnStore, not executeSelect
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Store } from 'n3'
import { fetchClassDescription } from '@/lib/sparql/classDescription'
import { executeSelect, executeSelectOnStore } from '@/lib/sparql/engine'

vi.mock('@/lib/sparql/engine', () => ({
  executeSelect: vi.fn(),
  executeSelectOnStore: vi.fn(),
}))

const CTX        = { endpointUrl: 'https://dbpedia.org/sparql' }
const ACTOR_CLASS = 'http://dbpedia.org/ontology/Actor'

const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment'
const SKOS_DEF    = 'http://www.w3.org/2004/02/skos/core#definition'
const DBO_ABSTRACT = 'http://dbpedia.org/ontology/abstract'

function row(prop: string, val: string, lang = '') {
  return { prop: { value: prop, type: 'NamedNode' }, val: { value: val, type: 'Literal', lang } }
}

beforeEach(() => vi.clearAllMocks())

// ── fetchClassDescription ─────────────────────────────────────────────────────

describe('fetchClassDescription', () => {
  it('returns an empty string when the endpoint has no description for the class', async () => {
    vi.mocked(executeSelect).mockResolvedValue([])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('')
  })

  it('returns the rdfs:comment value when it is available in the requested language', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'A person who performs in films.', 'en'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('A person who performs in films.')
  })

  it('uses executeSelectOnStore for file uploads — no network call made', async () => {
    vi.mocked(executeSelectOnStore).mockResolvedValue([
      row(RDFS_COMMENT, 'An actor.', 'en'),
    ])

    const desc = await fetchClassDescription(ACTOR_CLASS, CTX, new Store())

    expect(executeSelectOnStore).toHaveBeenCalledTimes(1)
    expect(executeSelect).not.toHaveBeenCalled()
    expect(desc).toBe('An actor.')
  })

  // ── Property priority ─────────────────────────────────────────────────────────

  it('prefers rdfs:comment over skos:definition when both are present', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(SKOS_DEF,    'SKOS definition of Actor.', 'en'),
      row(RDFS_COMMENT, 'rdfs comment for Actor.',  'en'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('rdfs comment for Actor.')
  })

  it('falls back to skos:definition when rdfs:comment is absent', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(SKOS_DEF, 'A definition of Actor.', 'en'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('A definition of Actor.')
  })

  it('falls back to dbo:abstract when higher-priority properties are absent', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(DBO_ABSTRACT, 'DBpedia abstract text.', 'en'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('DBpedia abstract text.')
  })

  // ── Language priority ─────────────────────────────────────────────────────────

  it('returns the exact language match when available', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'An actor.', 'en'),
      row(RDFS_COMMENT, 'Ein Schauspieler.', 'de'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined, 'de')).toBe('Ein Schauspieler.')
  })

  it('falls back to English when the requested language has no match', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'An actor.', 'en'),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined, 'de')).toBe('An actor.')
  })

  it('falls back to an untagged literal when neither requested language nor English is available', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'Untagged description.', ''),
    ])

    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined, 'de')).toBe('Untagged description.')
  })

  it('falls back to the first available language when no other match exists', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'Un acteur.', 'fr'), // only French available
    ])

    // Requested 'de', no 'en', no untagged → picks 'fr' as first available
    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined, 'de')).toBe('Un acteur.')
  })

  it('deduplicates rows for the same property — stores only unique (value, lang) pairs', async () => {
    vi.mocked(executeSelect).mockResolvedValue([
      row(RDFS_COMMENT, 'An actor.', 'en'),
      row(RDFS_COMMENT, 'A film actor.', 'en'), // second entry for same prop+lang
    ])

    // First English entry wins
    expect(await fetchClassDescription(ACTOR_CLASS, CTX, undefined)).toBe('An actor.')
  })
})
