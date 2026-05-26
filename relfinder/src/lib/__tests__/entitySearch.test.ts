/**
 * Unit tests for EntitySearch component logic.
 *
 * Focuses on the META_CLASS_IRIS filtering behaviour (instancesOnly prop) and
 * the applyStatus message format. Both are critical to the entity picker UX:
 *   - instancesOnly=true must exclude schema-level constructs so users are only
 *     offered real domain instances on the Paths screen.
 *   - applyStatus must surface the correct count / empty message after search.
 */

import { describe, it, expect } from 'vitest'
import type { EntitySearchResult } from '@/lib/sparql/types'

// ── META_CLASS_IRIS (mirror EntitySearch.vue) ─────────────────────────────────
// Must stay in sync with the component's META_CLASS_IRIS constant.

const META_CLASS_IRIS = new Set([
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
  'http://www.w3.org/2002/07/owl#ObjectProperty',
  'http://www.w3.org/2002/07/owl#DatatypeProperty',
  'http://www.w3.org/2002/07/owl#AnnotationProperty',
  'http://www.w3.org/2002/07/owl#TransitiveProperty',
  'http://www.w3.org/2002/07/owl#SymmetricProperty',
  'http://www.w3.org/2002/07/owl#AsymmetricProperty',
  'http://www.w3.org/2002/07/owl#ReflexiveProperty',
  'http://www.w3.org/2002/07/owl#IrreflexiveProperty',
  'http://www.w3.org/2002/07/owl#FunctionalProperty',
  'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',
  'http://www.w3.org/2002/07/owl#Restriction',
  'http://www.w3.org/2002/07/owl#Ontology',
])

// ── Logic mirrors (must stay in sync with EntitySearch.vue) ──────────────────

function filterInstances(
  results: EntitySearchResult[],
  instancesOnly: boolean,
): EntitySearchResult[] {
  if (!instancesOnly) return results
  return results.filter((r) => !META_CLASS_IRIS.has(r.class))
}

function applyStatus(query: string, count: number): string {
  return count === 0
    ? `No results for "${query}"`
    : `${count} result${count === 1 ? '' : 's'} for "${query}"`
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const alice: EntitySearchResult = {
  iri: 'http://e.org/Alice',
  label: 'Alice',
  class: 'http://e.org/Person',
}
const bob: EntitySearchResult = {
  iri: 'http://e.org/Bob',
  label: 'Bob',
  class: 'http://e.org/Person',
}
const personClass: EntitySearchResult = {
  iri: 'http://e.org/Person',
  label: 'Person',
  class: 'http://www.w3.org/2002/07/owl#Class',
}
const knowsProp: EntitySearchResult = {
  iri: 'http://e.org/knows',
  label: 'knows',
  class: 'http://www.w3.org/2002/07/owl#ObjectProperty',
}
const rdfsClass: EntitySearchResult = {
  iri: 'http://e.org/Org',
  label: 'Org',
  class: 'http://www.w3.org/2000/01/rdf-schema#Class',
}

// ── filterInstances ───────────────────────────────────────────────────────────

describe('filterInstances', () => {
  describe('instancesOnly = false', () => {
    it('returns all results unchanged', () => {
      const input = [alice, personClass, knowsProp]
      expect(filterInstances(input, false)).toEqual(input)
    })

    it('preserves empty array', () => {
      expect(filterInstances([], false)).toEqual([])
    })
  })

  describe('instancesOnly = true', () => {
    it('removes OWL Class results', () => {
      expect(filterInstances([alice, personClass], true)).toEqual([alice])
    })

    it('removes OWL ObjectProperty results', () => {
      expect(filterInstances([alice, knowsProp], true)).toEqual([alice])
    })

    it('removes rdfs:Class results', () => {
      expect(filterInstances([alice, rdfsClass], true)).toEqual([alice])
    })

    it('keeps all results when none are meta-types', () => {
      const input = [alice, bob]
      expect(filterInstances(input, true)).toEqual(input)
    })

    it('returns empty array when all results are meta-types', () => {
      expect(filterInstances([personClass, knowsProp, rdfsClass], true)).toEqual([])
    })

    it('removes all 15 recognised OWL/RDF meta-types', () => {
      const metaResults: EntitySearchResult[] = [...META_CLASS_IRIS].map((iri) => ({
        iri: `http://e.org/X_${iri.split('#')[1] ?? iri}`,
        label: 'X',
        class: iri,
      }))
      expect(filterInstances(metaResults, true)).toHaveLength(0)
    })

    it('does not mutate the input array', () => {
      const input = [alice, personClass]
      filterInstances(input, true)
      expect(input).toHaveLength(2)
    })
  })
})

// ── applyStatus ───────────────────────────────────────────────────────────────

describe('applyStatus', () => {
  it('returns "No results for …" when count is 0', () => {
    expect(applyStatus('alice', 0)).toBe('No results for "alice"')
  })

  it('uses singular "result" when count is 1', () => {
    expect(applyStatus('alice', 1)).toBe('1 result for "alice"')
  })

  it('uses plural "results" when count > 1', () => {
    expect(applyStatus('alice', 5)).toBe('5 results for "alice"')
  })

  it('includes the exact query string in the message', () => {
    expect(applyStatus('Bob Smith', 3)).toContain('Bob Smith')
  })
})
