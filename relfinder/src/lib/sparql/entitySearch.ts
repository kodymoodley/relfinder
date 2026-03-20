/**
 * Entity search and metadata enrichment.
 *
 * Ported from:
 *   - SPARQLEndpoint.entities()            → searchEntities()
 *   - SPARQLEndpoint.label_for_entities()  → fetchLabels()
 *   - SPARQLEndpoint.type_for_entities()   → fetchTypes()
 *   - SPARQLEndpoint.entity_data_properties() → fetchDataProperties()
 *   - add_type_label()                     → enrichGraph() (calls fetchLabels + fetchTypes)
 *
 * All functions accept a `QueryContext` (endpoint URL + optional auth header)
 * and an optional N3.js `Store` for local-file mode. When `store` is provided,
 * `context` is ignored and queries run in-memory via Comunica.
 */

import type { Store } from 'n3'
import { executeSelect, executeSelectOnStore } from './engine'
import { getQueries } from './queryBuilder'
import { buildRelationshipsGraph, mergeEdgeDuplicates } from './graphBuilder'
import {
  QueryCyclesStrategy,
  type QueryContext,
  type EntitySearchResult,
  type DataProperty,
  type GraphNode,
  type RelationshipGraph,
  type RelationshipQueryConfig,
  type PathCollection,
} from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Splits an array into successive chunks of at most `size` elements. */
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/** Executes a query against either a remote endpoint or a local store. */
async function runSelect(
  query: string,
  context: QueryContext,
  store?: Store,
) {
  return store
    ? executeSelectOnStore(query, store)
    : executeSelect(query, context)
}

// ── Entity search ─────────────────────────────────────────────────────────────

/**
 * Retrieves entities of the given RDF classes from the endpoint.
 *
 * Ported from `SPARQLEndpoint.entities()`. The `allowedClasses` list replaces
 * the hardcoded `allowed_entity_classes` constructor parameter — pass an empty
 * array to return entities of any class.
 *
 * @param allowedClasses  Array of class IRIs to filter by (full IRIs, not prefixed).
 * @param limit           Maximum number of results (default 200 — avoids timeout on large endpoints).
 */
export async function searchEntities(
  context: QueryContext,
  allowedClasses: string[] = [],
  store?: Store,
  limit = 50,
  textFilter = '',
  language = 'en',
  customLabelProperties: string[] = [],
): Promise<EntitySearchResult[]> {
  const classFilter =
    allowedClasses.length > 0
      ? `FILTER (?ctype IN (${allowedClasses.map((c) => `<${c}>`).join(', ')}))`
      : ''

  // Escape backslashes and double-quotes so the string is safe inside a SPARQL
  // string literal, then wrap in STRSTARTS for case-insensitive prefix match.
  const labelFilter = textFilter.trim()
    ? `FILTER (STRSTARTS(LCASE(STR(?label)), LCASE("${textFilter.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")))`
    : ''

  const langFilter = language
    ? `FILTER (lang(?label) = '${language}' || lang(?label) = '')`
    : ''

  let query: string

  if (store) {
    // Local in-memory store: scan any xsd:string / lang-tagged predicate as a
    // label. This handles custom vocabularies (e.g. :hasName, :hasTitle) without
    // requiring the user to configure every predicate manually. Numeric and other
    // non-string datatypes are excluded by the FILTER.
    query = `
      SELECT DISTINCT ?s ?ctype ?label WHERE {
        ?s a ?ctype .
        ?s ?lp ?label .
        FILTER (isLiteral(?label) && (
          datatype(?label) = <http://www.w3.org/2001/XMLSchema#string> ||
          lang(?label) != ''
        ))
        ${classFilter}
        ${labelFilter}
        ${langFilter}
      } LIMIT ${limit}
    `
  } else {
    // Remote endpoint: restrict to a known set of label predicates so we don't
    // issue a full-scan query over a potentially huge dataset.
    const builtinLabelProps = [
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2004/02/skos/core#prefLabel',
      'http://xmlns.com/foaf/0.1/name',
      'http://schema.org/name',
      'http://purl.org/dc/elements/1.1/title',
      'http://purl.org/dc/terms/title',
    ]
    const allLabelProps = [...new Set([...builtinLabelProps, ...customLabelProperties])]
    const labelPropsValues = allLabelProps.map((p) => `<${p}>`).join('\n        ')

    query = `
      SELECT DISTINCT ?s ?ctype ?label WHERE {
        ?s a ?ctype .
        VALUES ?lp { ${labelPropsValues} }
        ?s ?lp ?label .
        ${classFilter}
        ${labelFilter}
        ${langFilter}
      } LIMIT ${limit}
    `
  }

  const bindings = await runSelect(query, context, store)

  // Deduplicate by IRI — an entity may have multiple matching string predicates
  // (e.g. both :hasName and :hasNationality), keep the first match only.
  const seen = new Set<string>()
  return bindings
    .filter((b) => b['s'] && b['label'] && b['ctype'])
    .reduce<EntitySearchResult[]>((acc, b) => {
      const iri = b['s']!.value
      if (!seen.has(iri)) {
        seen.add(iri)
        acc.push({ iri, label: b['label']!.value, class: b['ctype']!.value })
      }
      return acc
    }, [])
}

// ── Available class discovery ─────────────────────────────────────────────────

/**
 * Queries the endpoint for distinct `rdf:type` values used by any subject,
 * up to `limit` results. Used to populate the class-filter dropdown in the UI.
 */
export async function fetchAvailableClasses(
  context: QueryContext,
  limit = 50,
  store?: Store,
): Promise<string[]> {
  const query = `
    SELECT DISTINCT ?type WHERE {
      ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type .
      FILTER (!isBlank(?type))
    } LIMIT ${limit}
  `

  const bindings = await runSelect(query, context, store)

  return bindings
    .filter((b) => b['type'])
    .map((b) => b['type']!.value)
}

// ── Label fetching ────────────────────────────────────────────────────────────

/**
 * Fetches `rdfs:label` values for a batch of IRIs.
 *
 * Uses UNION subqueries rather than VALUES to maximise compatibility across
 * SPARQL 1.1 endpoints.
 *
 * Ported from `SPARQLEndpoint.label_for_entities()`.
 *
 * @returns A map of IRI → label string (English preferred; falls back to no-lang).
 */
export async function fetchLabels(
  iris: string[],
  context: QueryContext,
  store?: Store,
  language = 'en',
): Promise<Map<string, string>> {
  if (iris.length === 0) return new Map()

  const subqueries = iris
    .map((iri) => `{ ?p <http://www.w3.org/2000/01/rdf-schema#label> ?label FILTER(?p = <${iri}>) }`)
    .join('\n    UNION\n    ')

  const langFilter = language
    ? `FILTER (lang(?label) = '${language}' || lang(?label) = '')`
    : ''

  const query = `
    SELECT * WHERE {
      ${subqueries}
      ${langFilter}
    }
  `

  const bindings = await runSelect(query, context, store)

  const labelsMap = new Map<string, string>()
  for (const b of bindings) {
    const p = b['p']
    const label = b['label']
    if (p && label) labelsMap.set(p.value, label.value)
  }

  return labelsMap
}

// ── Type fetching ─────────────────────────────────────────────────────────────

/**
 * Fetches the most specific `rdf:type` for a batch of entity IRIs.
 *
 * When multiple types are returned for the same entity the last one is kept.
 * For endpoints like GraphDB that return types in hierarchical order this
 * produces the most specific type. Optionally filtered by `ontologyPrefix`
 * so that only types from the target ontology are considered.
 *
 * Pass an empty string for `ontologyPrefix` to accept types from any namespace.
 *
 * Ported from `SPARQLEndpoint.type_for_entities()`.
 */
export async function fetchTypes(
  iris: string[],
  context: QueryContext,
  ontologyPrefix = '',
  store?: Store,
): Promise<Map<string, string>> {
  if (iris.length === 0) return new Map()

  const subqueries = iris
    .map((iri) => `{ ?o <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type FILTER(?o = <${iri}> && !isBlank(?type)) }`)
    .join('\n    UNION\n    ')

  const query = `
    SELECT * WHERE {
      ${subqueries}
    }
  `

  const bindings = await runSelect(query, context, store)

  const typesMap = new Map<string, string>()
  for (const b of bindings) {
    const o = b['o']
    const type = b['type']
    if (!o || !type) continue
    const typeIri = type.value
    if (!ontologyPrefix || typeIri.startsWith(ontologyPrefix)) {
      typesMap.set(o.value, typeIri)
    }
  }

  return typesMap
}

// ── Data properties ───────────────────────────────────────────────────────────

/**
 * Fetches literal data properties for a single entity — used to populate
 * the node detail panel in the UI.
 *
 * Ported from `SPARQLEndpoint.entity_data_properties()`.
 */
export async function fetchDataProperties(
  entityIri: string,
  context: QueryContext,
  limit = 50,
  store?: Store,
  language = 'en',
): Promise<DataProperty[]> {
  const langFilter = language
    ? `FILTER (lang(?propLabel) = '${language}' || lang(?propLabel) = '')`
    : ''

  const query = `
    SELECT DISTINCT ?p ?propLabel ?propValue WHERE {
      <${entityIri}> ?p ?propValue .
      ?p <http://www.w3.org/2000/01/rdf-schema#label> ?propLabel .
      FILTER isLiteral(?propValue)
      ${langFilter}
    } LIMIT ${limit}
  `

  const bindings = await runSelect(query, context, store)

  const seen = new Map<string, DataProperty>()
  for (const b of bindings) {
    const p = b['p']
    const propLabel = b['propLabel']
    const propValue = b['propValue']
    if (!p || !propLabel || !propValue) continue
    if (!seen.has(p.value)) {
      seen.set(p.value, { iri: p.value, label: propLabel.value, value: propValue.value })
    }
  }

  return Array.from(seen.values())
}

// ── Graph enrichment ──────────────────────────────────────────────────────────

/**
 * Fetches `rdfs:label` and `rdf:type` for all nodes and edge properties,
 * then updates them in-place via `applyLabelsAndTypes` from `graphBuilder.ts`.
 *
 * Requests are chunked (default: 50 IRIs per query) to stay within the URL
 * and query-complexity limits of most SPARQL endpoints.
 *
 * This is the TypeScript equivalent of `add_type_label()` from
 * relfinder-api/api/helpers/sparql/__init__.py.
 *
 * @param ontologyPrefix  Only types whose IRI starts with this string are
 *   recorded. Pass an empty string to accept types from any namespace.
 * @param chunkSize  Number of IRIs per label/type query batch.
 */
export async function enrichGraph(
  nodes: GraphNode[],
  edges: { iri: string; label: string }[],
  context: QueryContext,
  ontologyPrefix = '',
  chunkSize = 50,
  store?: Store,
  language = 'en',
): Promise<void> {
  const propIris = edges.map((e) => e.iri)
  const nodeIris = nodes.map((n) => n.iri)

  const allLabelIris = [...propIris, ...nodeIris]

  // Merge chunked label results
  const labelsMap = new Map<string, string>()
  for (const chunk of chunks(allLabelIris, chunkSize)) {
    const partial = await fetchLabels(chunk, context, store, language)
    for (const [k, v] of partial) labelsMap.set(k, v)
  }

  // Merge chunked type results
  const typesMap = new Map<string, string>()
  for (const chunk of chunks(nodeIris, chunkSize)) {
    const partial = await fetchTypes(chunk, context, ontologyPrefix, store)
    for (const [k, v] of partial) typesMap.set(k, v)
  }

  // Apply in-place (mirrors graphBuilder.applyLabelsAndTypes)
  for (const node of nodes) {
    const label = labelsMap.get(node.iri)
    if (label) node.label = label
    node.class = typesMap.get(node.iri) ?? 'Thing'
  }

  for (const edge of edges) {
    const label = labelsMap.get(edge.iri)
    if (label) edge.label = label
  }
}

/**
 * Convenience wrapper: executes all relationship queries, assembles the graph,
 * enriches labels/types, merges duplicate edges, and returns the final
 * `RelationshipGraph` ready for the UI.
 *
 * This consolidates the logic that was spread across the Flask `/query` route
 * and the `SPARQLEndpoint.find_relationships()` method.
 */
export async function findRelationships(
  entity1: string,
  entity2: string,
  maxDistance: number,
  context: QueryContext,
  options: {
    ignoredProperties?: string[]
    ignoredObjects?: string[]
    allowedObjectProperties?: string[]
    ontologyPrefix?: string
    avoidCycles?: QueryCyclesStrategy
    store?: Store
    language?: string
  } = {},
): Promise<RelationshipGraph> {
  const queryConfig: RelationshipQueryConfig = {
    entity1IRI: entity1,
    entity2IRI: entity2,
    ignoredObjects: options.ignoredObjects ?? [],
    ignoredProperties: options.ignoredProperties ?? [
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'http://www.w3.org/2004/02/skos/core#subject',
    ],
    avoidCycles: options.avoidCycles ?? QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES,
    maxDistance,
    allowedObjectProperties: options.allowedObjectProperties ?? [],
  }

  const queryBlocks = getQueries(queryConfig)
  const pathCollections: PathCollection[] = []

  for (const blocks of queryBlocks.values()) {
    for (const block of blocks) {
      const paths = await runSelect(block.query, context, options.store)
      pathCollections.push({ src: block.src, dest: block.dest, paths })
    }
  }

  const { nodes, edges } = buildRelationshipsGraph(
    entity1,
    entity2,
    pathCollections,
    options.allowedObjectProperties ?? [],
  )

  await enrichGraph(nodes, edges, context, options.ontologyPrefix ?? '', 50, options.store, options.language ?? 'en')

  const mergedEdges = mergeEdgeDuplicates(edges)
  const classes = [...new Set(nodes.map((n) => n.class))]

  return { nodes, edges: mergedEdges, classes }
}
