/**
 * Unit tests for src/lib/rdf/parser.ts
 *
 * Covers:
 *  - detectFormat: each supported extension, unknown extensions, edge cases
 *  - parseRdfContent: valid input for every MIME type, syntax errors
 *  - fileToStore: happy path per format, unsupported extension rejection
 *
 * No network or browser APIs needed — N3.js runs fine in Node/jsdom.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Literal as RdfLiteral } from 'n3'
import { describe, it, expect } from 'vitest'
import { detectFormat, parseRdfContent, fileToStore, storeSize } from '../rdf/parser'

const FIXTURES = resolve(process.cwd(), 'tests/fixtures')

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8')
}

// ── detectFormat ──────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('returns text/turtle for .ttl', () => {
    expect(detectFormat('graph.ttl')).toBe('text/turtle')
  })

  it('returns text/turtle for .n3 (N3 notation uses the Turtle parser)', () => {
    expect(detectFormat('data.n3')).toBe('text/turtle')
  })

  it('returns application/n-triples for .nt', () => {
    expect(detectFormat('triples.nt')).toBe('application/n-triples')
  })

  it('returns application/n-quads for .nq', () => {
    expect(detectFormat('quads.nq')).toBe('application/n-quads')
  })

  it('returns application/trig for .trig', () => {
    expect(detectFormat('dataset.trig')).toBe('application/trig')
  })

  it('returns null for an unrecognised extension', () => {
    expect(detectFormat('data.rdf')).toBeNull()
    expect(detectFormat('data.jsonld')).toBeNull()
    expect(detectFormat('data.xml')).toBeNull()
    expect(detectFormat('data.owl')).toBeNull()
  })

  it('returns null for a file with no extension', () => {
    expect(detectFormat('noextension')).toBeNull()
  })

  it('is case-insensitive for the extension', () => {
    expect(detectFormat('GRAPH.TTL')).toBe('text/turtle')
    expect(detectFormat('DATA.NT')).toBe('application/n-triples')
    expect(detectFormat('QUADS.NQ')).toBe('application/n-quads')
    expect(detectFormat('SET.TRIG')).toBe('application/trig')
  })

  it('handles filenames with multiple dots (uses last segment)', () => {
    expect(detectFormat('my.graph.data.ttl')).toBe('text/turtle')
    expect(detectFormat('v2.0.nt')).toBe('application/n-triples')
  })
})

// ── parseRdfContent ───────────────────────────────────────────────────────────

describe('parseRdfContent', () => {
  describe('Turtle (.ttl)', () => {
    const turtle = `
      @prefix ex: <http://example.org/> .
      ex:Alice a ex:Person .
      ex:Alice ex:knows ex:Bob .
    `

    it('parses valid Turtle and returns a Store with the correct triple count', async () => {
      const store = await parseRdfContent(turtle, 'text/turtle')
      expect(storeSize(store)).toBe(2)
    })

    it('the parsed triples use the correct subject IRIs', async () => {
      const store = await parseRdfContent(turtle, 'text/turtle')
      const quads = store.getQuads(null, null, null, null)
      const subjects = new Set(quads.map((q) => q.subject.value))
      expect(subjects.has('http://example.org/Alice')).toBe(true)
    })
  })

  describe('N3 notation (.n3) — parsed as Turtle', () => {
    const n3 = `
      @prefix ex: <http://example.org/> .
      ex:Cat a ex:Animal .
    `

    it('parses valid N3 content as Turtle and returns the expected triples', async () => {
      const store = await parseRdfContent(n3, 'text/turtle')
      expect(storeSize(store)).toBe(1)
    })
  })

  describe('N-Triples (.nt)', () => {
    const ntriples = [
      '<http://example.org/Alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Person> .',
      '<http://example.org/Bob> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Person> .',
    ].join('\n')

    it('parses valid N-Triples and returns the correct triple count', async () => {
      const store = await parseRdfContent(ntriples, 'application/n-triples')
      expect(storeSize(store)).toBe(2)
    })

    it('both subjects are present in the parsed store', async () => {
      const store = await parseRdfContent(ntriples, 'application/n-triples')
      const subjects = store.getQuads(null, null, null, null).map((q) => q.subject.value)
      expect(subjects).toContain('http://example.org/Alice')
      expect(subjects).toContain('http://example.org/Bob')
    })
  })

  describe('N-Quads (.nq)', () => {
    const nquads = [
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> <http://example.org/g> .',
      '<http://example.org/s2> <http://example.org/p> "hello" <http://example.org/g> .',
    ].join('\n')

    it('parses valid N-Quads and returns the correct quad count', async () => {
      const store = await parseRdfContent(nquads, 'application/n-quads')
      expect(storeSize(store)).toBe(2)
    })

    it('preserves the named graph IRI', async () => {
      const store = await parseRdfContent(nquads, 'application/n-quads')
      const quads = store.getQuads(null, null, null, null)
      const graphs = new Set(quads.map((q) => q.graph.value))
      expect(graphs.has('http://example.org/g')).toBe(true)
    })
  })

  describe('TriG (.trig)', () => {
    const trig = `
      @prefix ex: <http://example.org/> .
      ex:graph1 {
        ex:Alice a ex:Person .
      }
      ex:graph2 {
        ex:Bob a ex:Person .
        ex:Bob ex:knows ex:Alice .
      }
    `

    it('parses valid TriG and returns the correct quad count across named graphs', async () => {
      const store = await parseRdfContent(trig, 'application/trig')
      expect(storeSize(store)).toBe(3)
    })

    it('triples from different named graphs are both present', async () => {
      const store = await parseRdfContent(trig, 'application/trig')
      const subjects = store.getQuads(null, null, null, null).map((q) => q.subject.value)
      expect(subjects).toContain('http://example.org/Alice')
      expect(subjects).toContain('http://example.org/Bob')
    })
  })

  describe('error handling', () => {
    it('rejects with an Error when Turtle content has a syntax error', async () => {
      const broken = `@prefix ex: <http://example.org/> . ex:Alice BAD SYNTAX`
      await expect(parseRdfContent(broken, 'text/turtle')).rejects.toThrow('RDF parse error')
    })

    it('rejects with an Error when N-Triples content is malformed', async () => {
      const broken = `not-a-valid-triple`
      await expect(parseRdfContent(broken, 'application/n-triples')).rejects.toThrow(
        'RDF parse error',
      )
    })

    it('resolves to an empty Store for an empty string', async () => {
      const store = await parseRdfContent('', 'text/turtle')
      expect(storeSize(store)).toBe(0)
    })
  })
})

// ── fileToStore ───────────────────────────────────────────────────────────────

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' })
}

describe('fileToStore', () => {
  const turtle = `
    @prefix ex: <http://example.org/> .
    ex:X a ex:Thing .
  `

  it('parses a .ttl file and returns a populated Store', async () => {
    const store = await fileToStore(makeFile('data.ttl', turtle))
    expect(storeSize(store)).toBe(1)
  })

  it('parses a .n3 file using the Turtle parser', async () => {
    const store = await fileToStore(makeFile('data.n3', turtle))
    expect(storeSize(store)).toBe(1)
  })

  it('parses a .nt file', async () => {
    const nt =
      '<http://example.org/X> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Thing> .'
    const store = await fileToStore(makeFile('data.nt', nt))
    expect(storeSize(store)).toBe(1)
  })

  it('parses a .nq file', async () => {
    const nq =
      '<http://example.org/X> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Thing> <http://example.org/g> .'
    const store = await fileToStore(makeFile('data.nq', nq))
    expect(storeSize(store)).toBe(1)
  })

  it('parses a .trig file', async () => {
    const trig = `@prefix ex: <http://example.org/> . ex:g { ex:X a ex:Thing . }`
    const store = await fileToStore(makeFile('data.trig', trig))
    expect(storeSize(store)).toBe(1)
  })

  it('rejects with a descriptive error for an unsupported extension', async () => {
    await expect(fileToStore(makeFile('data.rdf', '<x>'))).rejects.toThrow(
      'Unsupported file extension',
    )
  })

  it('includes the unsupported extension name in the error message', async () => {
    await expect(fileToStore(makeFile('graph.jsonld', '{}'))).rejects.toThrow('jsonld')
  })

  it('includes the list of supported formats in the error message', async () => {
    await expect(fileToStore(makeFile('data.xml', '<x>'))).rejects.toThrow('.ttl')
  })
})

// ── storeSize ─────────────────────────────────────────────────────────────────

describe('storeSize', () => {
  it('returns 0 for an empty store', async () => {
    const store = await parseRdfContent('', 'text/turtle')
    expect(storeSize(store)).toBe(0)
  })

  it('matches the number of triples parsed', async () => {
    const turtle = `
      @prefix ex: <http://example.org/> .
      ex:A a ex:T .
      ex:B a ex:T .
      ex:C a ex:T .
    `
    const store = await parseRdfContent(turtle, 'text/turtle')
    expect(storeSize(store)).toBe(3)
  })
})

// ── Rich fixture files ────────────────────────────────────────────────────────

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

describe('rich fixture files', () => {
  describe('.ttl — Turtle (academic knowledge graph)', () => {
    const content = loadFixture('rich-graph.ttl')

    it('parses without error and returns 450+ triples', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      expect(storeSize(store)).toBeGreaterThanOrEqual(450)
    })

    it('contains multilingual rdfs:labels (en, de, fr)', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const quads = store.getQuads(null, RDFS_LABEL, null, null)
      const langs = new Set(quads.map((q) => (q.object as RdfLiteral).language).filter(Boolean))
      expect(langs.has('en')).toBe(true)
      expect(langs.has('de')).toBe(true)
      expect(langs.has('fr')).toBe(true)
    })

    it('contains typed datatype literals (xsd:date, xsd:gYear, xsd:nonNegativeInteger)', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const datatypes = new Set(
        store
          .getQuads(null, null, null, null)
          .filter((q) => q.object.termType === 'Literal')
          .map((q) => (q.object as RdfLiteral).datatype.value),
      )
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#date')).toBe(true)
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#gYear')).toBe(true)
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#nonNegativeInteger')).toBe(true)
    })

    it('contains blank nodes (used for postal addresses)', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const hasBlankNode = store
        .getQuads(null, null, null, null)
        .some((q) => q.subject.termType === 'BlankNode')
      expect(hasBlankNode).toBe(true)
    })

    it('contains the expected researcher IRI as a subject', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const subjects = new Set(store.getQuads(null, null, null, null).map((q) => q.subject.value))
      expect(subjects.has('http://example.org/kg/AliceSmith')).toBe(true)
    })
  })

  describe('.n3 — N3 notation (software ecosystem)', () => {
    const content = loadFixture('rich-graph.n3')

    it('parses without error and returns 350+ triples', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      expect(storeSize(store)).toBeGreaterThanOrEqual(350)
    })

    it('contains multilingual rdfs:labels (en, de, fr)', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const quads = store.getQuads(null, RDFS_LABEL, null, null)
      const langs = new Set(quads.map((q) => (q.object as RdfLiteral).language).filter(Boolean))
      expect(langs.has('en')).toBe(true)
      expect(langs.has('de')).toBe(true)
      expect(langs.has('fr')).toBe(true)
    })

    it('contains gYear datatype literals (for founding/release years)', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const hasGYear = store
        .getQuads(null, null, null, null)
        .some(
          (q) =>
            q.object.termType === 'Literal' &&
            (q.object as RdfLiteral).datatype.value === 'http://www.w3.org/2001/XMLSchema#gYear',
        )
      expect(hasGYear).toBe(true)
    })

    it('contains the VSCode project IRI as a subject', async () => {
      const store = await parseRdfContent(content, 'text/turtle')
      const subjects = new Set(store.getQuads(null, null, null, null).map((q) => q.subject.value))
      expect(subjects.has('http://example.org/sw/VSCode')).toBe(true)
    })
  })

  describe('.nt — N-Triples (world literature)', () => {
    const content = loadFixture('rich-graph.nt')

    it('parses without error and returns 300+ triples', async () => {
      const store = await parseRdfContent(content, 'application/n-triples')
      expect(storeSize(store)).toBeGreaterThanOrEqual(300)
    })

    it('contains multilingual rdfs:labels (en, de, fr)', async () => {
      const store = await parseRdfContent(content, 'application/n-triples')
      const quads = store.getQuads(null, RDFS_LABEL, null, null)
      const langs = new Set(quads.map((q) => (q.object as RdfLiteral).language).filter(Boolean))
      expect(langs.has('en')).toBe(true)
      expect(langs.has('de')).toBe(true)
      expect(langs.has('fr')).toBe(true)
    })

    it('contains datatype literals (xsd:positiveInteger, xsd:gYear)', async () => {
      const store = await parseRdfContent(content, 'application/n-triples')
      const datatypes = new Set(
        store
          .getQuads(null, null, null, null)
          .filter((q) => q.object.termType === 'Literal')
          .map((q) => (q.object as RdfLiteral).datatype.value),
      )
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#positiveInteger')).toBe(true)
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#gYear')).toBe(true)
    })

    it('contains the expected book IRI as a subject', async () => {
      const store = await parseRdfContent(content, 'application/n-triples')
      const subjects = new Set(store.getQuads(null, null, null, null).map((q) => q.subject.value))
      expect(subjects.has('http://example.org/lib/Book100YearsSolitude')).toBe(true)
    })
  })

  describe('.nq — N-Quads (music, multiple named graphs)', () => {
    const content = loadFixture('rich-graph.nq')

    it('parses without error and returns 300+ quads', async () => {
      const store = await parseRdfContent(content, 'application/n-quads')
      expect(storeSize(store)).toBeGreaterThanOrEqual(300)
    })

    it('contains multilingual rdfs:labels (en, de, fr)', async () => {
      const store = await parseRdfContent(content, 'application/n-quads')
      const quads = store.getQuads(null, RDFS_LABEL, null, null)
      const langs = new Set(quads.map((q) => (q.object as RdfLiteral).language).filter(Boolean))
      expect(langs.has('en')).toBe(true)
      expect(langs.has('de')).toBe(true)
      expect(langs.has('fr')).toBe(true)
    })

    it('stores quads across multiple named graphs', async () => {
      const store = await parseRdfContent(content, 'application/n-quads')
      const graphs = new Set(
        store
          .getQuads(null, null, null, null)
          .map((q) => q.graph.value)
          .filter(Boolean),
      )
      expect(graphs.has('http://example.org/nq/ontology')).toBe(true)
      expect(graphs.has('http://example.org/nq/artists')).toBe(true)
      expect(graphs.has('http://example.org/nq/albums')).toBe(true)
    })

    it('contains the Beatles IRI as a subject', async () => {
      const store = await parseRdfContent(content, 'application/n-quads')
      const subjects = new Set(store.getQuads(null, null, null, null).map((q) => q.subject.value))
      expect(subjects.has('http://example.org/music/BeatlesArtist')).toBe(true)
    })
  })

  describe('.trig — TriG (cinema, multiple named graphs)', () => {
    const content = loadFixture('rich-graph.trig')

    it('parses without error and returns 300+ quads', async () => {
      const store = await parseRdfContent(content, 'application/trig')
      expect(storeSize(store)).toBeGreaterThanOrEqual(300)
    })

    it('contains multilingual rdfs:labels (en, de, fr)', async () => {
      const store = await parseRdfContent(content, 'application/trig')
      const quads = store.getQuads(null, RDFS_LABEL, null, null)
      const langs = new Set(quads.map((q) => (q.object as RdfLiteral).language).filter(Boolean))
      expect(langs.has('en')).toBe(true)
      expect(langs.has('de')).toBe(true)
      expect(langs.has('fr')).toBe(true)
    })

    it('stores quads across multiple named graphs', async () => {
      const store = await parseRdfContent(content, 'application/trig')
      const graphs = new Set(
        store
          .getQuads(null, null, null, null)
          .map((q) => q.graph.value)
          .filter(Boolean),
      )
      expect(graphs.has('http://example.org/film/schema')).toBe(true)
      expect(graphs.has('http://example.org/film/directors')).toBe(true)
      expect(graphs.has('http://example.org/film/films')).toBe(true)
    })

    it('contains typed literals (xsd:date, xsd:decimal)', async () => {
      const store = await parseRdfContent(content, 'application/trig')
      const datatypes = new Set(
        store
          .getQuads(null, null, null, null)
          .filter((q) => q.object.termType === 'Literal')
          .map((q) => (q.object as RdfLiteral).datatype.value),
      )
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#date')).toBe(true)
      expect(datatypes.has('http://www.w3.org/2001/XMLSchema#decimal')).toBe(true)
    })

    it('contains the Inception film IRI as a subject', async () => {
      const store = await parseRdfContent(content, 'application/trig')
      const subjects = new Set(store.getQuads(null, null, null, null).map((q) => q.subject.value))
      expect(subjects.has('http://example.org/film/FilmInception')).toBe(true)
    })
  })
})
