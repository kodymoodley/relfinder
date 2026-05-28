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
import { runSelect } from './engine'
import { chunk } from '../utils/array'
import { getQueries, RDF_TYPE, SKOS_SUBJECT } from './queryBuilder'
import { buildRelationshipsGraph, mergeEdgeDuplicates, applyLabelsAndTypes } from './graphBuilder'
import { shortIri } from '../utils/iri'
import { cacheGet, cacheSet } from '../cache/queryCache'
import type { LabelEntry } from './types'
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

/** Standard RDF label predicates tried in priority order when querying labels. */
const LABEL_PREDICATES = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2004/02/skos/core#prefLabel',
  'http://www.w3.org/2004/02/skos/core#altLabel',
  'http://xmlns.com/foaf/0.1/name',
  'http://schema.org/name',
  'http://purl.org/dc/elements/1.1/title',
  'http://purl.org/dc/terms/title',
]

/**
 * Returns a SPARQL FILTER clause that restricts `?label` to the given language
 * tag while also accepting untagged plain literals (lang = '').
 * Returns an empty string when `language` is empty (accept any language).
 */
function langFilterClause(variable: string, language: string): string {
  return language ? `FILTER (lang(${variable}) = '${language}' || lang(${variable}) = '')` : ''
}

// ── Entity search ─────────────────────────────────────────────────────────────

export interface SearchEntitiesOptions {
  /** Class IRIs to filter by. Empty array = any class. Default: []. */
  allowedClasses?: string[]
  /** Local N3 Store for file-upload mode. Omit for remote endpoint queries. */
  store?: Store
  /** Maximum result rows. Default: 50. */
  limit?: number
  /** Case-insensitive prefix filter applied to labels. Default: ''. */
  textFilter?: string
  /** Preferred label language tag. Default: 'en'. */
  language?: string
  /** Extra label predicates to try in addition to the built-in set. Default: []. */
  customLabelProperties?: string[]
}

/**
 * Retrieves entities of the given RDF classes from the endpoint.
 *
 * Ported from `SPARQLEndpoint.entities()`. Pass `options.allowedClasses` to
 * restrict results to specific types; an empty array returns any class.
 */
export async function searchEntities(
  context: QueryContext,
  options: SearchEntitiesOptions = {},
): Promise<EntitySearchResult[]> {
  const {
    allowedClasses = [],
    store,
    limit = 50,
    textFilter = '',
    language = 'en',
    customLabelProperties = [],
  } = options
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
    // Remote endpoint: restrict to a known set of label predicates.
    // Use FILTER(?lp IN (...)) instead of VALUES because Virtuoso rejects
    // inline VALUES inside a WHERE block (SP030 syntax error).
    const allLabelProps = [...new Set([...LABEL_PREDICATES, ...customLabelProperties])]
    const labelPropFilter = `FILTER(?lp IN (${allLabelProps.map((p) => `<${p}>`).join(', ')}))`

    // Single-class fast path: omit ?ctype from SELECT entirely so that Virtuoso's
    // failure to propagate BIND-inside-subgroup variables cannot silently drop all
    // results. The class IRI is injected from allowedClasses[0] directly.
    if (allowedClasses.length === 1) {
      const rows = await runSelect(
        `SELECT DISTINCT ?s ?label WHERE {
          ?s a <${allowedClasses[0]}> .
          ?s ?lp ?label .
          ${labelPropFilter}
          ${labelFilter}
          ${langFilter}
        } LIMIT ${limit}`,
        context,
      )
      const seen = new Set<string>()
      return rows
        .filter((b) => b['s'] && b['label'])
        .reduce<EntitySearchResult[]>((acc, b) => {
          const iri = b['s']!.value
          if (!seen.has(iri)) {
            seen.add(iri)
            acc.push({ iri, label: b['label']!.value, class: allowedClasses[0]! })
          }
          return acc
        }, [])
    }

    // Multi-class or unrestricted: bind the type so the engine can use the
    // rdf:type index rather than a full subject scan.
    let classPattern: string
    if (allowedClasses.length === 0) {
      classPattern = '?s a ?ctype .'
    } else {
      classPattern = allowedClasses
        .map((c) => `{ ?s a <${c}> . BIND(<${c}> AS ?ctype) }`)
        .join('\nUNION\n')
    }

    query = `
      SELECT DISTINCT ?s ?ctype ?label WHERE {
        ${classPattern}
        ?s ?lp ?label .
        ${labelPropFilter}
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
      ?s a ?type .
      FILTER (!isBlank(?type))
    } LIMIT ${limit}
  `

  const bindings = await runSelect(query, context, store)

  return bindings.filter((b) => b['type']).map((b) => b['type']!.value)
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
    // Preferred label predicates tried first; any string literal is the fallback
    // so custom vocabularies still produce a human-readable label.
    const preferredProps = LABEL_PREDICATES.map((p) => `<${p}>`).join('\n          ')

    const preferredLangFilter = langFilterClause('?preferredLabel', language)

    query = `
      SELECT DISTINCT ?s (COALESCE(?preferredLabel, ?fallbackLabel) AS ?label) WHERE {
        ?s a <${classIri}> .
        OPTIONAL {
          VALUES ?lp { ${preferredProps} }
          ?s ?lp ?preferredLabel .
          ${preferredLangFilter}
        }
        OPTIONAL {
          ?s ?anyProp ?fallbackLabel .
          FILTER (isLiteral(?fallbackLabel) && (
            datatype(?fallbackLabel) = <http://www.w3.org/2001/XMLSchema#string> ||
            lang(?fallbackLabel) != ''
          ))
        }
      } LIMIT ${limit}
    `
  } else {
    const labelProps = LABEL_PREDICATES.map((p) => `<${p}>`).join('\n        ')

    query = `
      SELECT DISTINCT ?s ?label WHERE {
        ?s a <${classIri}> .
        OPTIONAL {
          VALUES ?lp { ${labelProps} }
          ?s ?lp ?label .
          ${langFilter}
        }
      } LIMIT ${limit}
    `
  }

  const toInstances = (bindings: Awaited<ReturnType<typeof runSelect>>) => {
    const seen = new Set<string>()
    const out: Array<{ iri: string; label: string }> = []
    for (const b of bindings) {
      const s = b['s']
      if (!s) continue
      if (seen.has(s.value)) continue
      seen.add(s.value)
      out.push({ iri: s.value, label: b['label']?.value ?? shortIri(s.value) })
    }
    return out
  }

  const result = toInstances(await runSelect(query, context, store))

  cacheSet(cacheKey, result)
  return result
}

// ── Entity property details ───────────────────────────────────────────────────

/**
 * Fetches all literal properties of a single entity for display in the
 * instance detail panel.
 *
 * Unlike `fetchDataProperties`, this does not require predicates to carry
 * an rdfs:label — the local IRI name is used as a fallback so custom
 * vocabularies and file-based graphs still produce readable output.
 */
export async function fetchEntityProps(
  entityIri: string,
  context: QueryContext,
  store?: Store,
  limit = 20,
): Promise<Array<{ predIri: string; predLabel: string; value: string }>> {
  const query = `
    SELECT DISTINCT ?p ?pLabel ?o WHERE {
      <${entityIri}> ?p ?o .
      OPTIONAL { ?p <http://www.w3.org/2000/01/rdf-schema#label> ?pLabel . }
      FILTER(isLiteral(?o))
    } LIMIT ${limit}
  `

  const bindings = await runSelect(query, context, store)

  const seen = new Map<string, { predIri: string; predLabel: string; value: string }>()
  for (const b of bindings) {
    const p = b['p']
    const o = b['o']
    if (!p || !o) continue
    const key = `${p.value}::${o.value}`
    if (!seen.has(key)) {
      seen.set(key, {
        predIri: p.value,
        predLabel: b['pLabel']?.value ?? shortIri(p.value),
        value: o.value,
      })
    }
  }

  return Array.from(seen.values())
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
export function pickLabel(entries: LabelEntry[], language: string): string | undefined {
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
        `{ ?o a ?type FILTER(?o = <${iri}> && !isBlank(?type)) }`,
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
  for (const batch of chunk(allLabelIris, chunkSize)) {
    const partial = await fetchLabels(batch, context, store)
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
  for (const batch of chunk(nodeIris, chunkSize)) {
    const partial = await fetchTypes(batch, context, ontologyPrefix, store)
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
    ignoredProperties: options.ignoredProperties ?? [RDF_TYPE, SKOS_SUBJECT],
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
