// @vitest-environment node

/**
 * Tests for shortIri() in iri.ts.
 *
 * shortIri(iri) returns the fragment identifier when present (everything after
 * the last '#'), otherwise the last path segment (everything after the last '/').
 * When both produce an empty string (e.g. trailing-slash IRIs), the empty string
 * is returned — the ?? fallback only fires for null/undefined, not for ''.
 *
 * IRIs span OWL, RDFS, RDF, XSD, SKOS, Dublin Core, DBpedia, Wikidata,
 * Schema.org, FOAF, GeoNames, custom vocabularies, URNs, file:// URIs, and
 * several structural edge cases.
 */

import { describe, it, expect } from 'vitest'
import { shortIri } from '@/lib/utils/iri'

// ── OWL vocabulary ────────────────────────────────────────────────────────────

describe('shortIri — OWL vocabulary (fragment after #)', () => {
  it.each([
    ['http://www.w3.org/2002/07/owl#Class',               'Class'],
    ['http://www.w3.org/2002/07/owl#ObjectProperty',      'ObjectProperty'],
    ['http://www.w3.org/2002/07/owl#DatatypeProperty',    'DatatypeProperty'],
    ['http://www.w3.org/2002/07/owl#AnnotationProperty',  'AnnotationProperty'],
    ['http://www.w3.org/2002/07/owl#NamedIndividual',     'NamedIndividual'],
    ['http://www.w3.org/2002/07/owl#Thing',               'Thing'],
    ['http://www.w3.org/2002/07/owl#Nothing',             'Nothing'],
    ['http://www.w3.org/2002/07/owl#Ontology',            'Ontology'],
    ['http://www.w3.org/2002/07/owl#inverseOf',           'inverseOf'],
    ['http://www.w3.org/2002/07/owl#equivalentClass',     'equivalentClass'],
    ['http://www.w3.org/2002/07/owl#equivalentProperty',  'equivalentProperty'],
    ['http://www.w3.org/2002/07/owl#deprecated',          'deprecated'],
    ['http://www.w3.org/2002/07/owl#disjointWith',        'disjointWith'],
    ['http://www.w3.org/2002/07/owl#FunctionalProperty',  'FunctionalProperty'],
    ['http://www.w3.org/2002/07/owl#TransitiveProperty',  'TransitiveProperty'],
    ['http://www.w3.org/2002/07/owl#SymmetricProperty',   'SymmetricProperty'],
    ['http://www.w3.org/2002/07/owl#ReflexiveProperty',   'ReflexiveProperty'],
    ['http://www.w3.org/2002/07/owl#AsymmetricProperty',  'AsymmetricProperty'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── RDFS vocabulary ───────────────────────────────────────────────────────────

describe('shortIri — RDFS vocabulary', () => {
  it.each([
    ['http://www.w3.org/2000/01/rdf-schema#label',           'label'],
    ['http://www.w3.org/2000/01/rdf-schema#comment',         'comment'],
    ['http://www.w3.org/2000/01/rdf-schema#range',           'range'],
    ['http://www.w3.org/2000/01/rdf-schema#domain',          'domain'],
    ['http://www.w3.org/2000/01/rdf-schema#subClassOf',      'subClassOf'],
    ['http://www.w3.org/2000/01/rdf-schema#subPropertyOf',   'subPropertyOf'],
    ['http://www.w3.org/2000/01/rdf-schema#Class',           'Class'],
    ['http://www.w3.org/2000/01/rdf-schema#Resource',        'Resource'],
    ['http://www.w3.org/2000/01/rdf-schema#Literal',         'Literal'],
    ['http://www.w3.org/2000/01/rdf-schema#isDefinedBy',     'isDefinedBy'],
    ['http://www.w3.org/2000/01/rdf-schema#seeAlso',         'seeAlso'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── RDF core vocabulary ───────────────────────────────────────────────────────

describe('shortIri — RDF core vocabulary', () => {
  it.each([
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type',      'type'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',  'Property'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#subject',   'subject'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate', 'predicate'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#object',    'object'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#first',     'first'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#rest',      'rest'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#nil',       'nil'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#List',      'List'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement', 'Statement'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#value',     'value'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── XSD datatypes ─────────────────────────────────────────────────────────────

describe('shortIri — XSD datatype IRIs', () => {
  it.each([
    ['http://www.w3.org/2001/XMLSchema#string',             'string'],
    ['http://www.w3.org/2001/XMLSchema#integer',            'integer'],
    ['http://www.w3.org/2001/XMLSchema#decimal',            'decimal'],
    ['http://www.w3.org/2001/XMLSchema#date',               'date'],
    ['http://www.w3.org/2001/XMLSchema#dateTime',           'dateTime'],
    ['http://www.w3.org/2001/XMLSchema#boolean',            'boolean'],
    ['http://www.w3.org/2001/XMLSchema#float',              'float'],
    ['http://www.w3.org/2001/XMLSchema#double',             'double'],
    ['http://www.w3.org/2001/XMLSchema#anyURI',             'anyURI'],
    ['http://www.w3.org/2001/XMLSchema#nonNegativeInteger', 'nonNegativeInteger'],
    ['http://www.w3.org/2001/XMLSchema#positiveInteger',    'positiveInteger'],
    ['http://www.w3.org/2001/XMLSchema#gYear',              'gYear'],
    ['http://www.w3.org/2001/XMLSchema#gMonth',             'gMonth'],
    ['http://www.w3.org/2001/XMLSchema#hexBinary',          'hexBinary'],
    ['http://www.w3.org/2001/XMLSchema#base64Binary',       'base64Binary'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── SKOS vocabulary ───────────────────────────────────────────────────────────

describe('shortIri — SKOS vocabulary', () => {
  it.each([
    ['http://www.w3.org/2004/02/skos/core#prefLabel',     'prefLabel'],
    ['http://www.w3.org/2004/02/skos/core#altLabel',      'altLabel'],
    ['http://www.w3.org/2004/02/skos/core#hiddenLabel',   'hiddenLabel'],
    ['http://www.w3.org/2004/02/skos/core#definition',    'definition'],
    ['http://www.w3.org/2004/02/skos/core#broader',       'broader'],
    ['http://www.w3.org/2004/02/skos/core#narrower',      'narrower'],
    ['http://www.w3.org/2004/02/skos/core#Concept',       'Concept'],
    ['http://www.w3.org/2004/02/skos/core#ConceptScheme', 'ConceptScheme'],
    ['http://www.w3.org/2004/02/skos/core#related',       'related'],
    ['http://www.w3.org/2004/02/skos/core#inScheme',      'inScheme'],
    ['http://www.w3.org/2004/02/skos/core#notation',      'notation'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── Dublin Core ───────────────────────────────────────────────────────────────

describe('shortIri — Dublin Core (path-based, last segment is local name)', () => {
  it.each([
    ['http://purl.org/dc/elements/1.1/title',       'title'],
    ['http://purl.org/dc/elements/1.1/creator',     'creator'],
    ['http://purl.org/dc/elements/1.1/date',        'date'],
    ['http://purl.org/dc/elements/1.1/description', 'description'],
    ['http://purl.org/dc/elements/1.1/subject',     'subject'],
    ['http://purl.org/dc/elements/1.1/language',    'language'],
    ['http://purl.org/dc/terms/title',              'title'],
    ['http://purl.org/dc/terms/creator',            'creator'],
    ['http://purl.org/dc/terms/modified',           'modified'],
    ['http://purl.org/dc/terms/license',            'license'],
    ['http://purl.org/dc/terms/rights',             'rights'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── DBpedia resources ─────────────────────────────────────────────────────────

describe('shortIri — DBpedia resource IRIs', () => {
  it.each([
    ['http://dbpedia.org/resource/Cillian_Murphy',              'Cillian_Murphy'],
    ['http://dbpedia.org/resource/Christopher_Nolan',           'Christopher_Nolan'],
    ['http://dbpedia.org/resource/Oppenheimer_(film)',          'Oppenheimer_(film)'],
    ['http://dbpedia.org/resource/Emma_Thomas',                 'Emma_Thomas'],
    ['http://dbpedia.org/resource/United_States',               'United_States'],
    ['http://dbpedia.org/resource/Albert_Einstein',             'Albert_Einstein'],
    ['http://dbpedia.org/resource/Marie_Curie',                 'Marie_Curie'],
    ['http://dbpedia.org/resource/Eiffel_Tower',                'Eiffel_Tower'],
    ['http://dbpedia.org/resource/Python_(programming_language)', 'Python_(programming_language)'],
    ['http://dbpedia.org/resource/New_York_City',               'New_York_City'],
    ['http://dbpedia.org/resource/M%C3%BCnchen',                'M%C3%BCnchen'],
    ['http://dbpedia.org/resource/Women%27s_handball',          "Women%27s_handball"],
    ['http://dbpedia.org/resource/42_(number)',                  '42_(number)'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── DBpedia ontology and property ─────────────────────────────────────────────

describe('shortIri — DBpedia ontology and property terms', () => {
  it.each([
    ['http://dbpedia.org/ontology/Actor',         'Actor'],
    ['http://dbpedia.org/ontology/Film',          'Film'],
    ['http://dbpedia.org/ontology/Person',        'Person'],
    ['http://dbpedia.org/ontology/birthDate',     'birthDate'],
    ['http://dbpedia.org/ontology/director',      'director'],
    ['http://dbpedia.org/ontology/starring',      'starring'],
    ['http://dbpedia.org/ontology/abstract',      'abstract'],
    ['http://dbpedia.org/ontology/FilmDirector',  'FilmDirector'],
    ['http://dbpedia.org/ontology/Place',         'Place'],
    ['http://dbpedia.org/ontology/Country',       'Country'],
    ['http://dbpedia.org/property/name',          'name'],
    ['http://dbpedia.org/property/birthPlace',    'birthPlace'],
    ['http://dbpedia.org/property/nationality',   'nationality'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── Wikidata ──────────────────────────────────────────────────────────────────

describe('shortIri — Wikidata entity and property IRIs', () => {
  it.each([
    ['http://www.wikidata.org/entity/Q937',        'Q937'],   // Albert Einstein
    ['http://www.wikidata.org/entity/Q76',         'Q76'],    // Barack Obama
    ['http://www.wikidata.org/entity/Q42',         'Q42'],    // Douglas Adams
    ['http://www.wikidata.org/entity/Q5',          'Q5'],     // human
    ['http://www.wikidata.org/entity/Q6581072',    'Q6581072'],
    ['http://www.wikidata.org/entity/Q183',        'Q183'],   // Germany
    ['http://www.wikidata.org/entity/Q64',         'Q64'],    // Berlin
    ['http://www.wikidata.org/prop/direct/P31',    'P31'],    // instance of
    ['http://www.wikidata.org/prop/direct/P21',    'P21'],    // sex or gender
    ['http://www.wikidata.org/prop/direct/P569',   'P569'],   // date of birth
    ['http://www.wikidata.org/prop/direct/P570',   'P570'],   // date of death
    ['http://www.wikidata.org/prop/direct/P27',    'P27'],    // country of citizenship
    ['http://www.wikidata.org/prop/direct/P106',   'P106'],   // occupation
    ['http://www.wikidata.org/prop/direct/P18',    'P18'],    // image
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── Schema.org ────────────────────────────────────────────────────────────────

describe('shortIri — Schema.org terms', () => {
  it.each([
    ['http://schema.org/Person',           'Person'],
    ['http://schema.org/Movie',            'Movie'],
    ['http://schema.org/Organization',     'Organization'],
    ['http://schema.org/name',             'name'],
    ['http://schema.org/birthDate',        'birthDate'],
    ['http://schema.org/description',      'description'],
    ['http://schema.org/Event',            'Event'],
    ['http://schema.org/CreativeWork',     'CreativeWork'],
    ['http://schema.org/Place',            'Place'],
    ['http://schema.org/Country',          'Country'],
    ['http://schema.org/url',              'url'],
    ['http://schema.org/identifier',       'identifier'],
    ['http://schema.org/MusicRecording',   'MusicRecording'],
    ['https://schema.org/Person',          'Person'],   // HTTPS variant
    ['https://schema.org/SoftwareApplication', 'SoftwareApplication'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── FOAF ──────────────────────────────────────────────────────────────────────

describe('shortIri — FOAF vocabulary (path-based)', () => {
  it.each([
    ['http://xmlns.com/foaf/0.1/Person',      'Person'],
    ['http://xmlns.com/foaf/0.1/name',        'name'],
    ['http://xmlns.com/foaf/0.1/knows',       'knows'],
    ['http://xmlns.com/foaf/0.1/homepage',    'homepage'],
    ['http://xmlns.com/foaf/0.1/mbox',        'mbox'],
    ['http://xmlns.com/foaf/0.1/Agent',       'Agent'],
    ['http://xmlns.com/foaf/0.1/Organization','Organization'],
    ['http://xmlns.com/foaf/0.1/depiction',   'depiction'],
    ['http://xmlns.com/foaf/0.1/firstName',   'firstName'],
    ['http://xmlns.com/foaf/0.1/lastName',    'lastName'],
    ['http://xmlns.com/foaf/0.1/Document',    'Document'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── GeoNames ──────────────────────────────────────────────────────────────────

describe('shortIri — GeoNames ontology and resources', () => {
  it.each([
    ['http://www.geonames.org/ontology#Feature',       'Feature'],
    ['http://www.geonames.org/ontology#parentFeature', 'parentFeature'],
    ['http://www.geonames.org/ontology#CountryCode',   'CountryCode'],
    ['http://www.geonames.org/ontology#population',    'population'],
    ['http://sws.geonames.org/2950159/about.rdf',      'about.rdf'],
    ['http://sws.geonames.org/5128581/about.rdf',      'about.rdf'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── Custom and domain-specific vocabularies ───────────────────────────────────

describe('shortIri — custom and domain-specific vocabulary IRIs', () => {
  it.each([
    // BioPortal / life-sciences ontologies
    ['http://purl.obolibrary.org/obo/GO_0008150',              'GO_0008150'],
    ['http://purl.obolibrary.org/obo/CHEBI_15422',             'CHEBI_15422'],
    ['http://purl.obolibrary.org/obo/DOID_14566',              'DOID_14566'],
    // ORCiD / research identifiers
    ['https://orcid.org/0000-0002-1825-0097',                  '0000-0002-1825-0097'],
    // DOI
    ['https://doi.org/10.1000/xyz123',                         'xyz123'],
    // NASA/ESA linked data
    ['http://sweet.jpl.nasa.gov/2.3/propTemperature.owl#Temperature', 'Temperature'],
    // Linked Open Vocabularies
    ['http://www.w3.org/ns/prov#Entity',       'Entity'],
    ['http://www.w3.org/ns/prov#wasGeneratedBy', 'wasGeneratedBy'],
    ['http://www.w3.org/ns/prov#Agent',        'Agent'],
    ['http://www.w3.org/ns/org#Organization',  'Organization'],
    ['http://www.w3.org/ns/org#hasMember',     'hasMember'],
    // DCAT
    ['http://www.w3.org/ns/dcat#Dataset',      'Dataset'],
    ['http://www.w3.org/ns/dcat#Distribution', 'Distribution'],
    ['http://www.w3.org/ns/dcat#keyword',      'keyword'],
    // vCard
    ['http://www.w3.org/2006/vcard/ns#fn',     'fn'],
    ['http://www.w3.org/2006/vcard/ns#hasEmail', 'hasEmail'],
    // Time ontology
    ['http://www.w3.org/2006/time#Instant',    'Instant'],
    ['http://www.w3.org/2006/time#inXSDDate',  'inXSDDate'],
    // deep nested path
    ['http://www.example.org/very/deep/path/structure/FinalNode', 'FinalNode'],
    // camelCase property
    ['http://example.org/vocab#hasBirthPlace', 'hasBirthPlace'],
    // ALL_CAPS
    ['http://example.org/vocab#MAX_VALUE',     'MAX_VALUE'],
    // numeric local name
    ['http://example.org/class123',            'class123'],
    // hyphenated local name
    ['http://example.org/vocab/my-property',   'my-property'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── URNs and non-HTTP IRIs ────────────────────────────────────────────────────

describe('shortIri — URNs and non-HTTP schemes', () => {
  it.each([
    // URNs have no '/' after the scheme → entire string is the "last segment"
    ['urn:isbn:9780306406157',                                    'urn:isbn:9780306406157'],
    ['urn:isbn:0451450523',                                       'urn:isbn:0451450523'],
    ['urn:ietf:rfc:3986',                                         'urn:ietf:rfc:3986'],
    // UUID URNs — no slash, so whole string returned
    ['urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66',            'urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66'],
    // file:// URIs — last path segment extracted normally
    ['file:///home/user/data/ontology.ttl',                      'ontology.ttl'],
    ['file:///C:/Users/data/myOntology.owl',                     'myOntology.owl'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})

// ── Structural edge cases ─────────────────────────────────────────────────────

describe('shortIri — structural edge cases', () => {
  it.each([
    // No path at all — last slash segment is the hostname
    ['http://example.org',                    'example.org'],
    ['https://dbpedia.org',                   'dbpedia.org'],
    // Trailing slash → last segment is '' → shortIri returns ''
    ['http://example.org/',                   ''],
    ['http://xmlns.com/foaf/0.1/',            ''],
    ['http://www.w3.org/2002/07/owl/',        ''],
    // Fragment only (no path segment)
    ['http://example.org/#MyClass',           'MyClass'],
    ['http://example.org/ns#',               ''],    // trailing '#' → empty after last #
    // Multiple hash characters — last segment after final # is returned
    ['http://example.org/path#fragment1#fragment2', 'fragment2'],
    ['http://example.org/ns#A#B#C',          'C'],
    // Very short IRI
    ['http://a.b/c',                         'c'],
    // Fragment with underscore and number
    ['http://example.org/ont#Class_001',     'Class_001'],
    // Fragment identical to path segment (should prefer fragment)
    ['http://example.org/Actor#Actor',       'Actor'],
    // Deeply nested fragment ontology
    ['http://purl.obolibrary.org/obo/iao.owl#IAO_0000235', 'IAO_0000235'],
    // Path with version number
    ['http://www.example.org/ontology/2.0/Person', 'Person'],
    // HTTPS with port
    ['https://example.org:8080/ontology/Vehicle', 'Vehicle'],
  ])('shortIri(%s) === %s', (iri, expected) => {
    expect(shortIri(iri)).toBe(expected)
  })
})
