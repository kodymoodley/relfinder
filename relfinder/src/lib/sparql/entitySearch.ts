/**
 * Entity search and metadata enrichment.
 *
 * All functions accept a SparqlClient which encapsulates the connection
 * (endpoint URL, credentials, local N3 store for file-upload mode) and any
 * endpoint-specific quirks. Callers never need to pass (context, store?) pairs.
 */

import { SparqlClient } from './client'
import { chunk } from '../utils/array'
import { getQueries, RDF_TYPE, SKOS_SUBJECT } from './queryBuilder'
import { buildRelationshipsGraph, mergeEdgeDuplicates, applyLabelsAndTypes } from './graphBuilder'
import { shortIri } from '../utils/iri'
import { cacheGet, cacheSet } from '../cache/queryCache'
import type { LabelEntry } from './types'
import {
  QueryCyclesStrategy,
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

function langFilterClause(variable: string, language: string): string {
  return language ? `FILTER (lang(${variable}) = '${language}' || lang(${variable}) = '')` : ''
}

// ── Entity search ─────────────────────────────────────────────────────────────

export interface SearchEntitiesOptions {
  /** Class IRIs to filter by. Empty array = any class. Default: []. */
  allowedClasses?: string[]
  /** Maximum result rows. Default: 50. */
  limit?: number
  /** Case-insensitive prefix filter applied to labels. Default: ''. */
  textFilter?: string
  /** Preferred label language tag. Default: 'en'. */
  language?: string
  /** Extra label predicates to try in addition to the built-in set. Default: []. */
  customLabelProperties?: string[]
}

export async function searchEntities(
  client: SparqlClient,
  options: SearchEntitiesOptions = {},
): Promise<EntitySearchResult[]> {
  const {
    allowedClasses = [],
    limit = 50,
    textFilter = '',
    language = 'en',
    customLabelProperties = [],
  } = options

  const classFilter =
    allowedClasses.length > 0
      ? `FILTER (?ctype IN (${allowedClasses.map((c) => `<${c}>`).join(', ')}))`
      : ''

  const labelFilter = textFilter.trim()
    ? `FILTER (STRSTARTS(LCASE(STR(?label)), LCASE("${textFilter.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")))`
    : ''

  const langFilter = langFilterClause('?label', language)

  let query: string

  if (client.isFileSource) {
    query = `
      SELECT DISTINCT ?s ?ctype ?label WHERE {
        ?s a ?ctype .
        ?s ?lp ?label .
        FILTER (!isBlank(?s) && isLiteral(?label) && (
          datatype(?label) = <http://www.w3.org/2001/XMLSchema#string> ||
          lang(?label) != ''
        ))
        ${classFilter}
        ${labelFilter}
        ${langFilter}
      } LIMIT ${limit}
    `
  } else {
    const allLabelProps = [...new Set([...LABEL_PREDICATES, ...customLabelProperties])]
    const labelPropFilter = `FILTER(?lp IN (${allLabelProps.map((p) => `<${p}>`).join(', ')}))`

    if (allowedClasses.length === 1) {
      const rows = await client.select(
        `SELECT DISTINCT ?s ?label WHERE {
          ?s a <${allowedClasses[0]}> .
          ?s ?lp ?label .
          FILTER (!isBlank(?s))
          ${labelPropFilter}
          ${labelFilter}
          ${langFilter}
        } LIMIT ${limit}`,
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
        FILTER (!isBlank(?s))
        ${labelPropFilter}
        ${labelFilter}
        ${langFilter}
      } LIMIT ${limit}
    `
  }

  const bindings = await client.select(query)

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

export async function fetchAvailableClasses(client: SparqlClient, limit = 50): Promise<string[]> {
  const query = `
    SELECT DISTINCT ?type WHERE {
      ?s a ?type .
      FILTER (!isBlank(?type))
    } LIMIT ${limit}
  `
  const bindings = await client.select(query)
  return bindings.filter((b) => b['type']).map((b) => b['type']!.value)
}

// ── Instance loading ──────────────────────────────────────────────────────────

export async function fetchInstancesByClass(
  classIri: string,
  client: SparqlClient,
  limit = 300,
  language = 'en',
): Promise<Array<{ iri: string; label: string }>> {
  const cacheKey = `instances:${client.sourceKey}:${classIri}`
  const cached = cacheGet<Array<{ iri: string; label: string }>>(cacheKey)
  if (cached) return cached

  const langFilter = langFilterClause('?label', language)

  let query: string

  if (client.isFileSource) {
    const preferredProps = LABEL_PREDICATES.map((p) => `<${p}>`).join('\n          ')
    const preferredLangFilter = langFilterClause('?preferredLabel', language)

    query = `
      SELECT DISTINCT ?s (COALESCE(?preferredLabel, ?fallbackLabel) AS ?label) WHERE {
        ?s a <${classIri}> .
        FILTER (!isBlank(?s))
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
        FILTER (!isBlank(?s))
        OPTIONAL {
          VALUES ?lp { ${labelProps} }
          ?s ?lp ?label .
          ${langFilter}
        }
      } LIMIT ${limit}
    `
  }

  const seen = new Set<string>()
  const out: Array<{ iri: string; label: string }> = []
  for (const b of await client.select(query)) {
    const s = b['s']
    if (!s) continue
    if (seen.has(s.value)) continue
    seen.add(s.value)
    out.push({ iri: s.value, label: b['label']?.value ?? shortIri(s.value) })
  }

  cacheSet(cacheKey, out)
  return out
}

// ── Entity property details ───────────────────────────────────────────────────

export async function fetchEntityProps(
  entityIri: string,
  client: SparqlClient,
  limit = 20,
): Promise<Array<{ predIri: string; predLabel: string; value: string }>> {
  const query = `
    SELECT DISTINCT ?p ?pLabel ?o WHERE {
      <${entityIri}> ?p ?o .
      OPTIONAL { ?p <http://www.w3.org/2000/01/rdf-schema#label> ?pLabel . }
      FILTER(isLiteral(?o))
    } LIMIT ${limit}
  `

  const bindings = await client.select(query)

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

export async function fetchLabels(
  iris: string[],
  client: SparqlClient,
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

  const bindings = await client.select(query)

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

export async function fetchTypes(
  iris: string[],
  client: SparqlClient,
  ontologyPrefix = '',
): Promise<Map<string, string>> {
  if (iris.length === 0) return new Map()

  const subqueries = iris
    .map((iri) => `{ ?o a ?type FILTER(?o = <${iri}> && !isBlank(?type)) }`)
    .join('\n    UNION\n    ')

  const query = `
    SELECT * WHERE {
      ${subqueries}
    }
  `

  const bindings = await client.select(query)

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

export async function fetchDataProperties(
  entityIri: string,
  client: SparqlClient,
  limit = 50,
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

  const bindings = await client.select(query)

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

export async function enrichGraph(
  nodes: GraphNode[],
  edges: { iri: string; label: string }[],
  client: SparqlClient,
  ontologyPrefix = '',
  chunkSize = 50,
  language = 'en',
): Promise<Map<string, LabelEntry[]>> {
  const propIris = edges.map((e) => e.iri)
  const nodeIris = nodes.map((n) => n.iri)
  const isAbsoluteIri = (iri: string) =>
    iri.startsWith('http://') || iri.startsWith('https://') || iri.startsWith('urn:')
  const allLabelIris = [...new Set([...propIris, ...nodeIris])].filter(isAbsoluteIri)
  const validNodeIris = nodeIris.filter(isAbsoluteIri)

  const allLabels = new Map<string, LabelEntry[]>()
  for (const batch of chunk(allLabelIris, chunkSize)) {
    const partial = await fetchLabels(batch, client)
    for (const [k, v] of partial) allLabels.set(k, v)
  }

  const resolvedLabels = new Map<string, string>()
  for (const [iri, entries] of allLabels) {
    const label = pickLabel(entries, language)
    if (label) resolvedLabels.set(iri, label)
  }

  const typesMap = new Map<string, string>()
  for (const batch of chunk(validNodeIris, chunkSize)) {
    const partial = await fetchTypes(batch, client, ontologyPrefix)
    for (const [k, v] of partial) typesMap.set(k, v)
  }

  applyLabelsAndTypes(nodes, edges, resolvedLabels, typesMap)

  return allLabels
}

// ── Relationship path finding ─────────────────────────────────────────────────

export async function findRelationships(
  entity1: string,
  entity2: string,
  maxDistance: number,
  client: SparqlClient,
  options: {
    ignoredProperties?: string[]
    ignoredObjects?: string[]
    allowedObjectProperties?: string[]
    ontologyPrefix?: string
    avoidCycles?: QueryCyclesStrategy
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

  let queryIndex = 0
  for (const [distance, blocks] of queryBlocks.entries()) {
    for (const block of blocks) {
      queryIndex++
      console.log(
        `[findRelationships] query #${queryIndex} (distance=${distance}):\n${block.query}`,
      )
      try {
        const paths = await client.select(block.query)
        console.log(`[findRelationships] query #${queryIndex} → ${paths.length} row(s)`)
        pathCollections.push({ src: block.src, dest: block.dest, paths })
      } catch (err) {
        console.error(`[findRelationships] query #${queryIndex} FAILED:`, err)
        throw err
      }
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
    client,
    options.ontologyPrefix ?? '',
    50,
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
