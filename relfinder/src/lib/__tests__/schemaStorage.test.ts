import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveSchema, loadSchema, clearSchema } from '../cache/schemaStorage'
import type { PersistedSchema } from '../cache/schemaStorage'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://example.org/sparql'
const STORAGE_KEY = `rf:schema:v1:${ENDPOINT}`

function makeEntry(overrides: Partial<PersistedSchema> = {}): PersistedSchema {
  return {
    version: 1,
    endpointUrl: ENDPOINT,
    savedAt: Date.now(),
    classLimit: 100,
    edgeLimit: 50,
    nodes: [
      { iri: 'http://example.org/A', label: 'A' },
      { iri: 'http://example.org/B', label: 'B' },
    ],
    edges: [
      {
        sourceIri: 'http://example.org/A',
        targetIri: 'http://example.org/B',
        props: [{ iri: 'http://example.org/rel', label: 'rel', count: 5 }],
        totalCount: 5,
      },
    ],
    processedClassIris: ['http://example.org/A'],
    dataPropsCache: [
      [
        'http://example.org/A',
        [{ iri: 'http://example.org/name', label: 'name', datatypes: ['xsd:string'] }],
      ],
    ],
    descriptionCache: [['http://example.org/A', 'A thing called A']],
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('schemaStorage', () => {
  describe('saveSchema / loadSchema round-trip', () => {
    it('persists and restores all fields faithfully', () => {
      const entry = makeEntry()
      saveSchema(ENDPOINT, entry)

      const loaded = loadSchema(ENDPOINT)
      expect(loaded).not.toBeNull()
      expect(loaded!.endpointUrl).toBe(ENDPOINT)
      expect(loaded!.classLimit).toBe(100)
      expect(loaded!.edgeLimit).toBe(50)
      expect(loaded!.nodes).toHaveLength(2)
      expect(loaded!.nodes[0]).toEqual({ iri: 'http://example.org/A', label: 'A' })
      expect(loaded!.edges).toHaveLength(1)
      expect(loaded!.processedClassIris).toEqual(['http://example.org/A'])
      expect(loaded!.dataPropsCache).toHaveLength(1)
      expect(loaded!.descriptionCache).toHaveLength(1)
      expect(loaded!.descriptionCache[0][1]).toBe('A thing called A')
    })

    it('stores under a key namespaced by endpoint URL', () => {
      saveSchema(ENDPOINT, makeEntry())
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    })
  })

  describe('loadSchema', () => {
    it('returns null for an unknown endpoint', () => {
      expect(loadSchema('https://unknown.example')).toBeNull()
    })

    it('returns null and removes entry when version does not match', () => {
      saveSchema(ENDPOINT, makeEntry({ version: 99 }))
      expect(loadSchema(ENDPOINT)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('returns null and removes entry when TTL has expired', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)
      saveSchema(ENDPOINT, makeEntry({ savedAt: now }))

      // Advance past 7-day TTL
      vi.setSystemTime(now + 7 * 24 * 60 * 60 * 1000 + 1)

      expect(loadSchema(ENDPOINT)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('returns entry that is exactly at the TTL boundary (not yet expired)', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)
      saveSchema(ENDPOINT, makeEntry({ savedAt: now }))

      // Advance to exactly TTL — still valid
      vi.setSystemTime(now + 7 * 24 * 60 * 60 * 1000)
      expect(loadSchema(ENDPOINT)).not.toBeNull()
    })

    it('returns null gracefully when stored JSON is malformed', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
      expect(loadSchema(ENDPOINT)).toBeNull()
    })
  })

  describe('saveSchema', () => {
    it('overwrites an existing entry for the same endpoint', () => {
      saveSchema(ENDPOINT, makeEntry({ nodes: [{ iri: 'http://example.org/A', label: 'A' }] }))
      saveSchema(ENDPOINT, makeEntry({ nodes: [] }))

      const loaded = loadSchema(ENDPOINT)
      expect(loaded!.nodes).toHaveLength(0)
    })

    it('silently swallows QuotaExceededError', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('storage full', 'QuotaExceededError')
      })
      expect(() => saveSchema(ENDPOINT, makeEntry())).not.toThrow()
    })

    it('silently swallows SecurityError', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
      expect(() => saveSchema(ENDPOINT, makeEntry())).not.toThrow()
    })
  })

  describe('clearSchema', () => {
    it('removes the stored entry', () => {
      saveSchema(ENDPOINT, makeEntry())
      clearSchema(ENDPOINT)
      expect(loadSchema(ENDPOINT)).toBeNull()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('is a no-op when no entry exists', () => {
      expect(() => clearSchema('https://never-stored.example')).not.toThrow()
    })
  })

  describe('endpoint isolation', () => {
    it('two different endpoints do not share entries', () => {
      const ep1 = 'https://ep1.example/sparql'
      const ep2 = 'https://ep2.example/sparql'
      saveSchema(
        ep1,
        makeEntry({ endpointUrl: ep1, nodes: [{ iri: 'http://example.org/A', label: 'A' }] }),
      )
      saveSchema(ep2, makeEntry({ endpointUrl: ep2, nodes: [] }))

      expect(loadSchema(ep1)!.nodes).toHaveLength(1)
      expect(loadSchema(ep2)!.nodes).toHaveLength(0)
    })

    it('clearSchema only removes the target endpoint', () => {
      const ep1 = 'https://ep1.example/sparql'
      const ep2 = 'https://ep2.example/sparql'
      saveSchema(ep1, makeEntry({ endpointUrl: ep1 }))
      saveSchema(ep2, makeEntry({ endpointUrl: ep2 }))

      clearSchema(ep1)
      expect(loadSchema(ep1)).toBeNull()
      expect(loadSchema(ep2)).not.toBeNull()
    })
  })
})
