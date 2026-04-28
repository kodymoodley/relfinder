/**
 * Schema extractor — mines an implicit T-Box from instance-level (A-Box) data.
 *
 * Algorithm (inspired by LD-VOWL, modernised):
 *   Phase 1  Discover distinct classes via a single DISTINCT query.
 *   Labels   Fetch rdfs:label for each class in batches of 20.
 *   Phase 2  For each class, fire one parameterised query (VALUES ?c2 constrains
 *            target classes to the set found in Phase 1). Queries run in parallel
 *            with a concurrency cap so the endpoint is not overwhelmed.
 *            Edges arrive incrementally via onEdgesLoaded callback.
 *
 * This is O(n) round-trips vs. LD-VOWL's O(n²), and the per-class queries are
 * simple 2-way joins rather than the expensive 3-way join a single batch needs.
 */

import type { Store } from 'n3'
import { executeSelect, executeSelectOnStore } from './engine'
import { fetchLabels } from './entitySearch'
import { shortIri } from '../utils/iri'
import type { QueryContext, SchemaNode, SchemaEdge, SchemaGraph, SchemaProp, SchemaDataProp } from './types'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function runSelect(query: string, context: QueryContext, store?: Store) {
  return store ? executeSelectOnStore(query, store) : executeSelect(query, context)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface SchemaExtractionOptions {
  /** Max classes to discover. Default 100. */
  classLimit?: number
  /** Max (prop, targetClass) rows per source class. Default 50. */
  edgeLimit?: number
  /** Max concurrent Phase-2 queries. Default 5. */
  concurrency?: number
  /** Preferred language for labels. Default 'en'. */
  language?: string
}

export interface SchemaExtractionCallbacks {
  /** Called once after Phase 1 + label fetch — nodes are ready to render. */
  onClassesLoaded?: (nodes: SchemaNode[]) => void
  /** Called after each class's edges arrive — render incrementally. */
  onEdgesLoaded?: (edges: SchemaEdge[]) => void
  /** Called after every class query completes. */
  onProgress?: (completed: number, total: number) => void
}

// ── Phase 1 ───────────────────────────────────────────────────────────────────

async function fetchSchemaClasses(
  context: QueryContext,
  store: Store | undefined,
  limit: number,
): Promise<SchemaNode[]> {
  const query = `
    SELECT DISTINCT ?class WHERE {
      [] <${RDF_TYPE}> ?class .
      FILTER(isIRI(?class))
    } LIMIT ${limit}
  `
  const rows = await runSelect(query, context, store)
  return rows
    .filter((r) => r['class'])
    .map((r) => ({ iri: r['class']!.value, label: shortIri(r['class']!.value) }))
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

async function fetchEdgesForClass(
  sourceIri: string,
  allClassIris: string[],
  context: QueryContext,
  store: Store | undefined,
  limit: number,
): Promise<SchemaEdge[]> {
  const valuesClause = allClassIris.map((c) => `<${c}>`).join(' ')
  const query = `
    SELECT ?prop ?c2 (COUNT(*) AS ?n) WHERE {
      VALUES ?c2 { ${valuesClause} }
      ?s <${RDF_TYPE}> <${sourceIri}> .
      ?s ?prop ?o .
      ?o <${RDF_TYPE}> ?c2 .
      FILTER(?c2 != <${sourceIri}>)
    } GROUP BY ?prop ?c2
    ORDER BY DESC(?n)
    LIMIT ${limit}
  `
  const rows = await runSelect(query, context, store)

  // Collapse multiple properties for the same (source, target) pair into one edge
  const byTarget = new Map<string, SchemaProp[]>()
  for (const r of rows) {
    const propIri = r['prop']?.value
    const targetIri = r['c2']?.value
    const count = parseInt(r['n']?.value ?? '1', 10)
    if (!propIri || !targetIri) continue
    const props = byTarget.get(targetIri)
    const entry: SchemaProp = { iri: propIri, label: shortIri(propIri), count }
    if (props) props.push(entry)
    else byTarget.set(targetIri, [entry])
  }

  return Array.from(byTarget.entries()).map(([targetIri, props]) => ({
    sourceIri,
    targetIri,
    props,
    totalCount: props.reduce((s, p) => s + p.count, 0),
  }))
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function extractSchema(
  context: QueryContext,
  store: Store | undefined,
  options: SchemaExtractionOptions = {},
  callbacks: SchemaExtractionCallbacks = {},
  signal?: AbortSignal,
): Promise<SchemaGraph> {
  const { classLimit = 100, edgeLimit = 50, concurrency = 5, language = 'en' } = options

  // ── Phase 1: classes ────────────────────────────────────────────────────────
  const nodes = await fetchSchemaClasses(context, store, classLimit)
  if (signal?.aborted || nodes.length === 0) return { nodes, edges: [] }

  // Fetch labels in batches of 20 to avoid oversized UNION queries
  for (const batch of chunk(nodes.map((n) => n.iri), 20)) {
    if (signal?.aborted) break
    const labelMap = await fetchLabels(batch, context, store)
    for (const node of nodes) {
      const entries = labelMap.get(node.iri)
      if (!entries?.length) continue
      const best =
        entries.find((e) => e.lang === language) ??
        entries.find((e) => e.lang === '') ??
        entries.find((e) => e.lang === 'en') ??
        entries[0]
      if (best) node.label = best.value
    }
  }
  callbacks.onClassesLoaded?.(nodes)
  if (signal?.aborted) return { nodes, edges: [] }

  // ── Phase 2: edges ──────────────────────────────────────────────────────────
  const allClassIris = nodes.map((n) => n.iri)
  const allEdges: SchemaEdge[] = []
  let completed = 0
  const queue = [...nodes]

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return
      const node = queue.shift()!
      try {
        const edges = await fetchEdgesForClass(node.iri, allClassIris, context, store, edgeLimit)
        if (!signal?.aborted && edges.length > 0) {
          allEdges.push(...edges)
          callbacks.onEdgesLoaded?.(edges)
        }
      } catch {
        // Partial schema is still useful — skip classes that time out
      }
      callbacks.onProgress?.(++completed, nodes.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, nodes.length) }, worker),
  )

  return { nodes, edges: allEdges }
}

// ── Data properties for a class ───────────────────────────────────────────────

export async function fetchSchemaDataProperties(
  classIri: string,
  context: QueryContext,
  store: Store | undefined,
  limit = 50,
  onStatus?: (msg: string) => void,
): Promise<SchemaDataProp[]> {
  const query = `
    SELECT DISTINCT ?prop ?dt WHERE {
      ?s <${RDF_TYPE}> <${classIri}> .
      ?s ?prop ?val .
      FILTER(isLiteral(?val))
      BIND(DATATYPE(?val) AS ?dt)
    } ORDER BY ?prop LIMIT ${limit}
  `
  const rows = await runSelect(query, context, store)
  onStatus?.(`Processing ${rows.length} result row${rows.length === 1 ? '' : 's'}…`)

  const byProp = new Map<string, Set<string>>()
  for (const r of rows) {
    const propIri = r['prop']?.value
    const dt = r['dt']?.value ?? ''
    if (!propIri) continue
    const dts = byProp.get(propIri)
    if (dts) dts.add(dt)
    else byProp.set(propIri, new Set([dt]))
  }

  const result = Array.from(byProp.entries()).map(([iri, dts]) => ({
    iri,
    label: shortIri(iri),
    datatypes: [...dts].filter(Boolean).map(shortIri),
  }))
  onStatus?.(`Found ${result.length} data propert${result.length === 1 ? 'y' : 'ies'}`)
  return result
}
