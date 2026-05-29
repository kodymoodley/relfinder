/**
 * Quick-start example definitions.
 *
 * Each example bundles everything RelFinder needs to run a demonstration
 * query without the user having to supply an endpoint or upload a file:
 *   - TtlExample  — ships its own TTL dataset (loaded from an inline import)
 *   - SparqlExample — points at a public SPARQL endpoint
 *
 * The TTL files are imported as raw strings via Vite's `?raw` transform so
 * they are bundled at build time and require no network fetch at runtime.
 */

import moviesTtl from './examples/movies.ttl?raw'
import scientistsTtl from './examples/scientists.ttl?raw'
import type { QueryCyclesStrategy } from './sparql/types'
import { QueryCyclesStrategy as QCS } from './sparql/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExampleEntity {
  iri: string
  label: string
  /** rdf:type IRI — used to colour the entity chip */
  class: string
}

interface ExampleOptions {
  maxDistance: number
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
  language: string
}

export interface TtlExample {
  kind: 'ttl'
  id: string
  title: string
  description: string
  /** Raw Turtle content — parsed into an N3 Store when the example is loaded. */
  ttlContent: string
  /** Human-readable dataset name shown in the connection header. */
  fileName: string
  entity1: ExampleEntity
  entity2: ExampleEntity
  options: ExampleOptions
}

export interface SparqlExample {
  kind: 'sparql'
  id: string
  title: string
  description: string
  endpointUrl: string
  entity1: ExampleEntity
  entity2: ExampleEntity
  options: ExampleOptions
}

export type Example = TtlExample | SparqlExample

// ── Shared defaults ───────────────────────────────────────────────────────────

const DEFAULT_IGNORED = [
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'http://www.w3.org/2002/07/owl#sameAs',
]

const LOV_IGNORED = [
  ...DEFAULT_IGNORED,
  'http://purl.org/dc/terms/language', // "both in English" is a trivial path
]

// ── Example definitions ───────────────────────────────────────────────────────

export const EXAMPLES: Example[] = [
  // ── TTL: Film industry graph ─────────────────────────────────────────────
  {
    kind: 'ttl',
    id: 'movies-cillian-nolan',
    title: 'Film Industry',
    description:
      'Explores how Cillian Murphy and Christopher Nolan are connected through shared films, crew, and collaborators.',
    ttlContent: moviesTtl,
    fileName: 'movies.ttl',
    entity1: {
      iri: 'http://filmgraph.org/cillian',
      label: 'Cillian Murphy',
      class: 'http://filmgraph.org/Actor',
    },
    entity2: {
      iri: 'http://filmgraph.org/nolan',
      label: 'Christopher Nolan',
      class: 'http://filmgraph.org/Director',
    },
    options: {
      maxDistance: 3,
      ignoredProperties: DEFAULT_IGNORED,
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: '',
    },
  },

  // ── TTL: Science collaboration graph ─────────────────────────────────────
  {
    kind: 'ttl',
    id: 'scientists-einstein-bohr',
    title: 'Physics Pioneers',
    description:
      'Maps the relationship between Albert Einstein and Niels Bohr through shared discoveries, institutions, and the famous Solvay Conferences.',
    ttlContent: scientistsTtl,
    fileName: 'scientists.ttl',
    entity1: {
      iri: 'http://sciencegraph.org/einstein',
      label: 'Albert Einstein',
      class: 'http://sciencegraph.org/Physicist',
    },
    entity2: {
      iri: 'http://sciencegraph.org/bohr',
      label: 'Niels Bohr',
      class: 'http://sciencegraph.org/Physicist',
    },
    options: {
      maxDistance: 3,
      ignoredProperties: DEFAULT_IGNORED,
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: '',
    },
  },

  // ── SPARQL: DBpedia — film industry ──────────────────────────────────────
  {
    kind: 'sparql',
    id: 'dbpedia-cillian-nolan',
    title: 'DBpedia: Film Industry',
    description:
      'Queries the live DBpedia knowledge graph to find connections between Cillian Murphy and Christopher Nolan.',
    endpointUrl: 'https://dbpedia.org/sparql',
    entity1: {
      iri: 'http://dbpedia.org/resource/Cillian_Murphy',
      label: 'Cillian Murphy',
      class: 'http://dbpedia.org/ontology/Actor',
    },
    entity2: {
      iri: 'http://dbpedia.org/resource/Christopher_Nolan',
      label: 'Christopher Nolan',
      class: 'http://dbpedia.org/ontology/FilmDirector',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: [
        ...DEFAULT_IGNORED,
        'http://www.w3.org/2004/02/skos/core#subject',
        'http://dbpedia.org/ontology/wikiPageWikiLink',
        'http://dbpedia.org/ontology/wikiPageRedirects',
      ],
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },

  // ── SPARQL: DBpedia — science ─────────────────────────────────────────────
  {
    kind: 'sparql',
    id: 'dbpedia-einstein-bohr',
    title: 'DBpedia: Physics Pioneers',
    description:
      'Queries the live DBpedia knowledge graph to find connections between Albert Einstein and Niels Bohr.',
    endpointUrl: 'https://dbpedia.org/sparql',
    entity1: {
      iri: 'http://dbpedia.org/resource/Albert_Einstein',
      label: 'Albert Einstein',
      class: 'http://dbpedia.org/ontology/Scientist',
    },
    entity2: {
      iri: 'http://dbpedia.org/resource/Niels_Bohr',
      label: 'Niels Bohr',
      class: 'http://dbpedia.org/ontology/Scientist',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: [
        ...DEFAULT_IGNORED,
        'http://www.w3.org/2004/02/skos/core#subject',
        'http://dbpedia.org/ontology/wikiPageWikiLink',
        'http://dbpedia.org/ontology/wikiPageRedirects',
      ],
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },

  // ── SPARQL: LOV — FOAF & Schema.org ──────────────────────────────────────
  {
    kind: 'sparql',
    id: 'lov-foaf-schema',
    title: 'LOV: FOAF & Schema.org',
    description:
      'Discovers how the FOAF vocabulary and Schema.org are linked through Dan Brickley, who created FOAF and contributed to Schema.org.',
    endpointUrl: 'https://lov.linkeddata.es/dataset/lov/sparql',
    entity1: {
      iri: 'http://xmlns.com/foaf/0.1/',
      label: 'FOAF',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    entity2: {
      iri: 'http://schema.org/',
      label: 'Schema.org',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: LOV_IGNORED,
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },

  // ── SPARQL: LOV — FOAF & SemWeb Vocab Status ─────────────────────────────
  {
    kind: 'sparql',
    id: 'lov-foaf-vs',
    title: 'LOV: FOAF & Vocab Status',
    description:
      'Shows that FOAF and the SemWeb Vocab Status vocabulary share the same two creators: Libby Miller and Dan Brickley.',
    endpointUrl: 'https://lov.linkeddata.es/dataset/lov/sparql',
    entity1: {
      iri: 'http://xmlns.com/foaf/0.1/',
      label: 'FOAF',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    entity2: {
      iri: 'http://www.w3.org/2003/06/sw-vocab-status/ns',
      label: 'SemWeb Vocab Status',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: LOV_IGNORED,
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },

  // ── SPARQL: LOV — SKOS & PROV-O ──────────────────────────────────────────
  {
    kind: 'sparql',
    id: 'lov-skos-prov',
    title: 'LOV: SKOS & PROV-O',
    description:
      'Maps the connection between the SKOS knowledge-organisation vocabulary and the PROV-O provenance ontology through their shared W3C publisher.',
    endpointUrl: 'https://lov.linkeddata.es/dataset/lov/sparql',
    entity1: {
      iri: 'http://www.w3.org/2004/02/skos/core',
      label: 'SKOS',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    entity2: {
      iri: 'http://www.w3.org/ns/prov#',
      label: 'PROV-O',
      class: 'http://purl.org/vocommons/voaf#Vocabulary',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: LOV_IGNORED,
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },

  // ── SPARQL: DBpedia — Marie Curie & Einstein ──────────────────────────────
  {
    kind: 'sparql',
    id: 'dbpedia-curie-einstein',
    title: 'DBpedia: Curie & Einstein',
    description:
      'Finds connections between Marie Curie and Albert Einstein through shared awards, institutions, and the Solvay Conferences.',
    endpointUrl: 'https://dbpedia.org/sparql',
    entity1: {
      iri: 'http://dbpedia.org/resource/Marie_Curie',
      label: 'Marie Curie',
      class: 'http://dbpedia.org/ontology/Scientist',
    },
    entity2: {
      iri: 'http://dbpedia.org/resource/Albert_Einstein',
      label: 'Albert Einstein',
      class: 'http://dbpedia.org/ontology/Scientist',
    },
    options: {
      maxDistance: 2,
      ignoredProperties: [
        ...DEFAULT_IGNORED,
        'http://www.w3.org/2004/02/skos/core#subject',
        'http://dbpedia.org/ontology/wikiPageWikiLink',
        'http://dbpedia.org/ontology/wikiPageRedirects',
      ],
      avoidCycles: QCS.NO_INTERMEDIATE_DUPLICATES,
      language: 'en',
    },
  },
]
