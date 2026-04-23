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
import { buildRelationshipsGraph, mergeEdgeDuplicates, applyLabelsAndTypes } from './graphBuilder'
import { shortIri } from '../utils/iri'
import { cacheGet, cacheSet } from '../cache/queryCache'
import type { LabelEntry } from './types'
import {
  QueryCyclesStrategy,
  type QueryContext,
  type EntitySearchResult,
  type ClassInfo,
  type DataProperty,
  type GraphNode,
  type RelationshipGraph,
  type RelationshipQueryConfig,
  type PathCollection,
} from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns a SPARQL FILTER clause that restricts `?label` to the given language
 * tag while also accepting untagged plain literals (lang = '').
 * Returns an empty string when `language` is empty (accept any language).
 */
function langFilterClause(variable: string, language: string): string {
  return language ? `FILTER (lang(${variable}) = '${language}' || lang(${variable}) = '')` : ''
}

/** Splits an array into successive chunks of at most `size` elements. */
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/** Executes a query against either a remote endpoint or a local store. */
async function runSelect(query: string, context: QueryContext, store?: Store) {
  return store ? executeSelectOnStore(query, store) : executeSelect(query, context)
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
 * @param limit           Maximum result rows. 50 is conservative enough to stay within the
 *                        default timeout of most public endpoints while still providing
 *                        enough choices for the autocomplete dropdown.
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

  const langFilter = langFilterClause('?label', language)

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
      'http://www.w3.org/2004/02/skos/core#altLabel',
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

  return bindings.filter((b) => b['type']).map((b) => b['type']!.value)
}

// ── Class discovery with counts ───────────────────────────────────────────────

/**
 * Returns all distinct `rdf:type` values used in the source, sorted by
 * descending instance count.
 *
 * Results are cached for the session (5-minute TTL) since the class catalogue
 * of a knowledge graph changes rarely. The cache is invalidated automatically
 * when the user disconnects.
 *
 * @param limit  Max classes to return. 500 is enough for any practical KG while
 *   keeping the GROUP BY result set manageable.
 */
export async function fetchClassesWithCounts(
  context: QueryContext,
  store?: Store,
  limit = 500,
): Promise<ClassInfo[]> {
  const cacheKey = store ? 'classes:file' : `classes:${context.endpointUrl}`
  const cached = cacheGet<ClassInfo[]>(cacheKey)
  if (cached) return cached

  const query = `
    SELECT ?type (COUNT(?s) AS ?count) WHERE {
      ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type .
      FILTER (isIRI(?type))
    } GROUP BY ?type ORDER BY DESC(?count) LIMIT ${limit}
  `

  const bindings = await runSelect(query, context, store)

  const result: ClassInfo[] = bindings
    .filter((b) => b['type'] && b['count'])
    .map((b) => ({
      iri: b['type']!.value,
      label: shortIri(b['type']!.value),
      count: parseInt(b['count']!.value, 10),
    }))

  cacheSet(cacheKey, result)
  return result
}

// ── Instance loading ──────────────────────────────────────────────────────────

/**
 * Fetches up to `limit` instances of a given class with their preferred label.
 *
 * Falls back to `shortIri()` when no label is found. Results are cached for
 * the session so repeated expand/collapse cycles are free.
 *
 * @param limit  300 gives a comfortable working set while staying well within
 *   the default result-size limits of public endpoints.
 */
export async function fetchInstancesByClass(
  classIri: string,
  context: QueryContext,
  store?: Store,
  limit = 300,
  language = 'en',
): Promise<Array<{ iri: string; label: string }>> {
  const sourceKey = store ? 'file' : context.endpointUrl
  const cacheKey = `instances:${sourceKey}:${classIri}`
  const cached = cacheGet<Array<{ iri: string; label: string }>>(cacheKey)
  if (cached) return cached

  const langFilter = langFilterClause('?label', language)

  let query: string

  if (store) {
    query = `
      SELECT DISTINCT ?s ?label WHERE {
        ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${classIri}> .
        OPTIONAL {
          ?s ?lp ?label .
          FILTER (isLiteral(?label) && (
            datatype(?label) = <http://www.w3.org/2001/XMLSchema#string> ||
            lang(?label) != ''
          ))
        }
      } LIMIT ${limit}
    `
  } else {
    const labelProps = [
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2004/02/skos/core#prefLabel',
      'http://www.w3.org/2004/02/skos/core#altLabel',
      'http://xmlns.com/foaf/0.1/name',
      'http://schema.org/name',
      'http://purl.org/dc/elements/1.1/title',
      'http://purl.org/dc/terms/title',
    ].map((p) => `<${p}>`).join('\n        ')

    query = `
      SELECT DISTINCT ?s ?label WHERE {
        ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${classIri}> .
        OPTIONAL {
          VALUES ?lp { ${labelProps} }
          ?s ?lp ?label .
          ${langFilter}
        }
      } LIMIT ${limit}
    `
  }

  const bindings = await runSelect(query, context, store)

  const seen = new Set<string>()
  const result: Array<{ iri: string; label: string }> = []

  for (const b of bindings) {
    const s = b['s']
    if (!s) continue
    const iri = s.value
    if (seen.has(iri)) continue
    seen.add(iri)
    result.push({ iri, label: b['label']?.value ?? shortIri(iri) })
  }

  cacheSet(cacheKey, result)
  return result
}

// ── Label fetching ────────────────────────────────────────────────────────────

/**
 * Fetches label values for a batch of IRIs across ALL language tags.
 *
 * Returning every available language in one query lets the UI switch display
 * language purely client-side without re-running the path traversal.
 *
 * Uses UNION subqueries rather than VALUES for broad endpoint compatibility.
 *
 * @returns A map of IRI → all label entries (value + lang tag).
 */
export async function fetchLabels(
  iris: string[],
  context: QueryContext,
  store?: Store,
): Promise<Map<string, LabelEntry[]>> {
  if (iris.length === 0) return new Map()

  const subqueries = iris
    .map(
      (iri) => `{ ?p <http://www.w3.org/2000/01/rdf-schema#label> ?label FILTER(?p = <${iri}>) }`,
    )
    .join('\n    UNION\n    ')

  const query = `
    SELECT * WHERE {
      ${subqueries}
    }
  `

  const bindings = await runSelect(query, context, store)

  const labelsMap = new Map<string, LabelEntry[]>()
  for (const b of bindings) {
    const p = b['p']
    const label = b['label']
    if (!p || !label) continue
    const entry: LabelEntry = { value: label.value, lang: label.lang ?? '' }
    const existing = labelsMap.get(p.value)
    if (existing) existing.push(entry)
    else labelsMap.set(p.value, [entry])
  }

  return labelsMap
}

/**
 * Picks the best label from a set of multi-language entries for the given tag.
 *
 * Priority: exact language match → untagged literal → 'en' → first available.
 */
function pickLabel(entries: LabelEntry[], language: string): string | undefined {
  if (language) {
    const exact = entries.find((e) => e.lang === language)
    if (exact) return exact.value
  }
  const untagged = entries.find((e) => e.lang === '')
  if (untagged) return untagged.value
  if (language !== 'en') {
    const en = entries.find((e) => e.lang === 'en')
    if (en) return en.value
  }
  return entries[0]?.value
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
    .map(
      (iri) =>
        `{ ?o <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type FILTER(?o = <${iri}> && !isBlank(?type)) }`,
    )
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
  const effectiveLang = language || 'en'
  const langFilter = [
    langFilterClause('?propLabel', effectiveLang),
    langFilterClause('?propValue', effectiveLang),
  ].join('\n      ')

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
 * @param chunkSize  IRIs per label/type query batch. 50 keeps each UNION subquery
 *   within the complexity limits of most public SPARQL endpoints.
 */
export async function enrichGraph(
  nodes: GraphNode[],
  edges: { iri: string; label: string }[],
  context: QueryContext,
  ontologyPrefix = '',
  chunkSize = 50,
  store?: Store,
  language = 'en',
): Promise<Map<string, LabelEntry[]>> {
  const propIris = edges.map((e) => e.iri)
  const nodeIris = nodes.map((n) => n.iri)
  const allLabelIris = [...new Set([...propIris, ...nodeIris])]

  // Fetch all language tags in one pass per chunk
  const allLabels = new Map<string, LabelEntry[]>()
  for (const chunk of chunks(allLabelIris, chunkSize)) {
    const partial = await fetchLabels(chunk, context, store)
    for (const [k, v] of partial) allLabels.set(k, v)
  }

  // Resolve to a single label per IRI for the requested language
  const resolvedLabels = new Map<string, string>()
  for (const [iri, entries] of allLabels) {
    const label = pickLabel(entries, language)
    if (label) resolvedLabels.set(iri, label)
  }

  // Merge chunked type results
  const typesMap = new Map<string, string>()
  for (const chunk of chunks(nodeIris, chunkSize)) {
    const partial = await fetchTypes(chunk, context, ontologyPrefix, store)
    for (const [k, v] of partial) typesMap.set(k, v)
  }

  applyLabelsAndTypes(nodes, edges, resolvedLabels, typesMap)

  return allLabels
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

  let queryIndex = 0
  for (const blocks of queryBlocks.values()) {
    for (const block of blocks) {
      queryIndex++
      console.log(`[findRelationships] query ${queryIndex} — src: ${block.src} dest: ${block.dest}\n${block.query}`)
      const paths = await runSelect(block.query, context, options.store)
      console.log(`[findRelationships] query ${queryIndex} returned ${paths.length} rows`)
      pathCollections.push({ src: block.src, dest: block.dest, paths })
    }
  }

  const { nodes, edges } = buildRelationshipsGraph(
    entity1,
    entity2,
    pathCollections,
    options.allowedObjectProperties ?? [],
  )

  const allLabels = await enrichGraph(
    nodes,
    edges,
    context,
    options.ontologyPrefix ?? '',
    50,
    options.store,
    options.language ?? 'en',
  )

  const mergedEdges = mergeEdgeDuplicates(edges)
  const classes = [...new Set(nodes.map((n) => n.class))]

  return { nodes, edges: mergedEdges, classes, allLabels }
}

/**
 * Re-applies display labels to all nodes and edges in an existing graph for a
 * different language tag — no network calls, uses the `allLabels` map stored
 * at query time.
 *
 * Call this instead of re-running `findRelationships` when only the language
 * preference changes.
 */
export function refreshGraphLabels(graph: RelationshipGraph, language: string): void {
  for (const node of graph.nodes) {
    const entries = graph.allLabels.get(node.iri)
    if (entries) {
      const label = pickLabel(entries, language)
      if (label) node.label = label
    }
  }
  for (const edge of graph.edges) {
    const labels = edge.iris
      .map((iri) => {
        const entries = graph.allLabels.get(iri)
        return entries ? pickLabel(entries, language) : undefined
      })
      .filter(Boolean) as string[]
    if (labels.length > 0) edge.label = labels.join(' | ')
  }
}
