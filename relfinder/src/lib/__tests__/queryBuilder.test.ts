// @vitest-environment node

/**
 * Unit tests for queryBuilder.ts — pure SPARQL query construction.
 *
 * Focuses on the four uncovered branch areas:
 *
 *   uri() unsafe local name (line 86)
 *     When an IRI starts with a known namespace but the local part contains
 *     a character illegal in SPARQL PNAME_LN (e.g. apostrophe, space), the
 *     function must break out and use angle-bracket form instead.
 *
 *   uri() already-prefixed IRI (line 94)
 *     An IRI that is already in prefixed form (e.g. 'rdfs:label') must be
 *     returned as-is without re-wrapping.
 *
 *   generateFilter() empty terms (line 186)
 *     When ignoredProperties, ignoredObjects, and cycle avoidance are all
 *     absent, no FILTER clause should be emitted (empty FILTER () is invalid SPARQL).
 *
 *   generateMiddleObjectQuery() intermediate hop (line 302)
 *     When dist2 >= 3 the inner loop has iterations where x + 1 < distance,
 *     exercising the else branch that emits an intermediate object variable.
 */

import { describe, it, expect } from 'vitest'
import { uri, generateFilter, middleObjectQuery, DEFAULT_PREFIXES } from '@/lib/sparql/queryBuilder'
import { QueryCyclesStrategy } from '@/lib/sparql/types'
import type { RelationshipQueryConfig } from '@/lib/sparql/types'

const E1 = 'http://dbpedia.org/resource/Cillian_Murphy'
const E2 = 'http://dbpedia.org/resource/Christopher_Nolan'

function baseConfig(overrides: Partial<RelationshipQueryConfig> = {}): RelationshipQueryConfig {
  return {
    entity1IRI: E1,
    entity2IRI: E2,
    ignoredObjects: [],
    ignoredProperties: [],
    avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES,
    maxDistance: 2,
    allowedObjectProperties: [],
    ...overrides,
  }
}

// ── uri() ─────────────────────────────────────────────────────────────────────

describe('uri()', () => {
  it('converts a known namespace IRI to prefixed form', () => {
    expect(uri('http://www.w3.org/2000/01/rdf-schema#label')).toBe('rdfs:label')
  })

  it('wraps an unknown IRI in angle brackets', () => {
    expect(uri('http://example.org/myProp')).toBe('<http://example.org/myProp>')
  })

  it('wraps in angle brackets when the local name is unsafe (e.g. contains a space)', () => {
    // Namespace matches rdfs: but local part has a space — PNAME_LN is unsafe
    const iriWithSpace = 'http://www.w3.org/2000/01/rdf-schema#label test'
    expect(uri(iriWithSpace)).toBe(`<${iriWithSpace}>`)
  })

  it("wraps in angle brackets when the local name contains an apostrophe (Women's handball)", () => {
    const iriWithApostrophe = "http://dbpedia.org/resource/Women's_handball"
    // Does not start with any known namespace, so goes straight to angle brackets
    expect(uri(iriWithApostrophe)).toBe(`<${iriWithApostrophe}>`)
  })

  it('returns an already-prefixed IRI unchanged (e.g. rdfs:label)', () => {
    // 'rdfs:label' — prefix 'rdfs' is in DEFAULT_PREFIXES, so it is returned as-is
    expect(uri('rdfs:label', DEFAULT_PREFIXES)).toBe('rdfs:label')
  })

  it('wraps a colon-containing IRI in angle brackets when its prefix is unknown', () => {
    // 'unknown:label' — 'unknown' is not in DEFAULT_PREFIXES
    expect(uri('unknown:label')).toBe('<unknown:label>')
  })
})

// ── generateFilter() ──────────────────────────────────────────────────────────

describe('generateFilter()', () => {
  it('returns an empty string when there are no constraints — avoids invalid FILTER ()', () => {
    const config = baseConfig({
      ignoredProperties: [],
      ignoredObjects: [],
      avoidCycles: QueryCyclesStrategy.NONE,
    })

    const filter = generateFilter(config, { pred: [], obj: [] })

    expect(filter).toBe('')
  })

  it('emits a FILTER clause when ignoredProperties are set', () => {
    const config = baseConfig({
      ignoredProperties: ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'],
      avoidCycles: QueryCyclesStrategy.NONE,
    })

    const filter = generateFilter(config, { pred: ['?pf1'], obj: [] })

    expect(filter).toContain('FILTER')
    expect(filter).toContain('!= rdf:type')
  })

  it('skips blank ignoredProperty entries to avoid producing invalid <> tokens', () => {
    const config = baseConfig({
      ignoredProperties: ['', '  '], // both blank
      avoidCycles: QueryCyclesStrategy.NONE,
    })

    const filter = generateFilter(config, { pred: ['?pf1'], obj: [] })

    expect(filter).toBe('') // no valid terms produced
  })

  it('emits cycle-avoidance terms when avoidCycles is set', () => {
    const config = baseConfig({ avoidCycles: QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES })

    const filter = generateFilter(config, { pred: ['?pf1'], obj: ['?of1'] })

    expect(filter).toContain('FILTER')
    // Intermediate object must not equal either endpoint
    expect(filter).toContain('?of1 != ')
  })
})

// ── middleObjectQuery() — intermediate hop (line 302) ────────────────────────

describe('middleObjectQuery()', () => {
  it('generates a query for dist1=1, dist2=1 (the minimal middle-object case)', () => {
    const block = middleObjectQuery(E1, E2, 1, 1, true, baseConfig())
    expect(block.query).toContain('?middle')
    expect(block.src).toBe(E1)
    expect(block.dest).toBe(E2)
  })

  it('generates a query for dist2=3 — exercises the intermediate-hop else branch', () => {
    // With dist2=3 the inner loop runs: x=1 (intermediate), x=2 (final → ?middle)
    // The x=1 iteration hits the else branch (line 302) producing ?os2 variable
    const block = middleObjectQuery(E1, E2, 1, 3, true, baseConfig())

    expect(block.query).toContain('?middle')
    expect(block.query).toContain('?os2') // intermediate object in second chain
  })

  it('throws when dist1 < 1', () => {
    expect(() => middleObjectQuery(E1, E2, 0, 1, true, baseConfig())).toThrow(RangeError)
  })

  it('throws when dist2 < 1', () => {
    expect(() => middleObjectQuery(E1, E2, 1, 0, true, baseConfig())).toThrow(RangeError)
  })
})
