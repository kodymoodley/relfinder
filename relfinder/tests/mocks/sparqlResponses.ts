/**
 * Pre-built SPARQL JSON responses for Playwright network mocking.
 *
 * Each object matches the SPARQL 1.1 JSON Results format so Playwright can
 * return them verbatim when intercepting endpoint requests.
 */

export interface SparqlJsonResult {
  head: { vars: string[] }
  results: {
    bindings: Record<string, { type: string; value: string; 'xml:lang'?: string }>[]
  }
}

// ── Phase 1: class discovery ──────────────────────────────────────────────────

export const twoClassesResponse: SparqlJsonResult = {
  head: { vars: ['class'] },
  results: {
    bindings: [
      { class: { type: 'uri', value: 'http://example.org/Person' } },
      { class: { type: 'uri', value: 'http://example.org/Project' } },
    ],
  },
}

export const emptyClassesResponse: SparqlJsonResult = {
  head: { vars: ['class'] },
  results: { bindings: [] },
}

export const manyClassesResponse: SparqlJsonResult = {
  head: { vars: ['class'] },
  results: {
    bindings: Array.from({ length: 20 }, (_, i) => ({
      class: { type: 'uri', value: `http://example.org/Class${i}` },
    })),
  },
}

// ── Phase 2: edge discovery ───────────────────────────────────────────────────

export const personToProjectEdgesResponse: SparqlJsonResult = {
  head: { vars: ['prop', 'c2', 'n'] },
  results: {
    bindings: [
      {
        prop: { type: 'uri', value: 'http://example.org/worksOn' },
        c2:   { type: 'uri', value: 'http://example.org/Project' },
        n:    { type: 'literal', value: '3' },
      },
    ],
  },
}

export const noEdgesResponse: SparqlJsonResult = {
  head: { vars: ['prop', 'c2', 'n'] },
  results: { bindings: [] },
}

// ── Label fetching ────────────────────────────────────────────────────────────

export const labelsResponse: SparqlJsonResult = {
  head: { vars: ['iri', 'label', 'lang'] },
  results: {
    bindings: [
      {
        iri:   { type: 'uri',     value: 'http://example.org/Person' },
        label: { type: 'literal', value: 'Person', 'xml:lang': 'en' },
        lang:  { type: 'literal', value: 'en' },
      },
      {
        iri:   { type: 'uri',     value: 'http://example.org/Project' },
        label: { type: 'literal', value: 'Project', 'xml:lang': 'en' },
        lang:  { type: 'literal', value: 'en' },
      },
    ],
  },
}

// ── Entity search (BM25 / text search) ───────────────────────────────────────

export const entitySearchResponse: SparqlJsonResult = {
  head: { vars: ['iri', 'label', 'class'] },
  results: {
    bindings: [
      {
        iri:   { type: 'uri',     value: 'http://example.org/alice' },
        label: { type: 'literal', value: 'Alice', 'xml:lang': 'en' },
        class: { type: 'uri',     value: 'http://example.org/Person' },
      },
      {
        iri:   { type: 'uri',     value: 'http://example.org/bob' },
        label: { type: 'literal', value: 'Bob', 'xml:lang': 'en' },
        class: { type: 'uri',     value: 'http://example.org/Person' },
      },
    ],
  },
}

// ── Connectivity probe (SELECT * LIMIT 1) ────────────────────────────────────

export const pingResponse: SparqlJsonResult = {
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri',     value: 'http://example.org/alice' },
        p: { type: 'uri',     value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        o: { type: 'uri',     value: 'http://example.org/Person' },
      },
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Headers returned with every mocked SPARQL response. */
export const sparqlJsonHeaders = {
  'Content-Type': 'application/sparql-results+json',
  'Access-Control-Allow-Origin': '*',
}

/**
 * Serialise a SparqlJsonResult to the string body Playwright will return.
 */
export function toBody(result: SparqlJsonResult): string {
  return JSON.stringify(result)
}
