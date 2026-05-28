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
import { runSelect } from './engine'
import { chunk } from '../utils/array'
import { fetchLabels, pickLabel } from './entitySearch'
import { shortIri } from '../utils/iri'
import type {
  QueryContext,
  SchemaNode,
  SchemaEdge,
  SchemaGraph,
  SchemaProp,
  SchemaDataProp,
} from './types'
import { DESCRIPTION_PROPERTIES } from './classDescription'

export interface SchemaExtractionOptions {
  /** Max classes to discover. Default 40. */
  classLimit?: number
  /** Max (prop, targetClass) rows per source class. Default 10. */
  edgeLimit?: number
  /** Max concurrent Phase-2 queries. Default 5. */
  concurrency?: number
  /** Preferred language for labels. Default 'en'. */
  language?: string
  /**
   * Skip Phase 1 entirely and use these nodes instead.
   * Useful when resuming a partial extraction from persistent storage.
   */
  preloadedNodes?: SchemaNode[]
  /**
   * Class IRIs to skip in Phase 2 (edges already fetched in a previous run).
   * The completed counter is initialised to this set's size so progress
   * reporting stays accurate across resume.
   */
  skipClasses?: Set<string>
  /**
   * Number of classes to skip before fetching the next page.
   * Requires ORDER BY in the Phase 1 query for deterministic pagination.
   * Default 0 (first page).
   */
  classOffset?: number
  /**
   * Extra class IRIs to include in the Phase 2 VALUES clause as edge targets,
   * but NOT processed as source classes. Use when loading a new page so that
   * edges between the new batch and previously-loaded classes are discovered.
   */
  additionalClassIris?: string[]
}

export interface SchemaExtractionCallbacks {
  /** Called once after Phase 1 + label fetch — nodes are ready to render. */
  onClassesLoaded?: (nodes: SchemaNode[]) => void
  /** Called after each class's edges arrive — render incrementally. */
  onEdgesLoaded?: (edges: SchemaEdge[]) => void
  /** Called after every class query completes (including skipped ones). */
  onProgress?: (completed: number, total: number) => void
  /** Called after each class finishes Phase 2 — use to persist incremental state. */
  onClassProcessed?: (classIri: string) => void
  /** Called per label batch with best description per class IRI (empty string = none found). */
  onDescriptionsLoaded?: (descriptions: Map<string, string>) => void
}

// ── Phase 1 ───────────────────────────────────────────────────────────────────

async function fetchSchemaClasses(
  context: QueryContext,
  store: Store | undefined,
  limit: number,
  offset = 0,
): Promise<SchemaNode[]> {
  // ORDER BY is only needed when paginating (offset > 0) to ensure stable
  // page boundaries. Skipping it on the first page avoids a full-sort scan
  // on large endpoints that would otherwise time out.
  const query = `
    SELECT DISTINCT ?class WHERE {
      [] a ?class .
    }${offset > 0 ? '\n    ORDER BY ?class' : ''}
    LIMIT ${limit}${offset > 0 ? `\n    OFFSET ${offset}` : ''}
  `
  const rows = await runSelect(query, context, store)
  return rows
    .filter((r) => r['class']?.type === 'NamedNode')
    .map((r) => ({ iri: r['class']!.value, label: shortIri(r['class']!.value) }))
}

// ── Phase 1b: descriptions ────────────────────────────────────────────────────

async function fetchDescriptionsBatch(
  iris: string[],
  context: QueryContext,
  store: Store | undefined,
  language = 'en',
): Promise<Map<string, string>> {
  const classValues = iris.map((c) => `<${c}>`).join(' ')
  const propValues = DESCRIPTION_PROPERTIES.map((p) => `<${p}>`).join(' ')
  const query = `
    SELECT ?class ?prop ?val WHERE {
      VALUES ?class { ${classValues} }
      VALUES ?prop { ${propValues} }
      ?class ?prop ?val .
      FILTER(isLiteral(?val))
    }
  `
  const rows = await runSelect(query, context, store)

  const byClass = new Map<string, Map<string, { value: string; lang: string }[]>>()
  for (const r of rows) {
    const classIri = r['class']?.value
    const prop = r['prop']?.value
    const val = r['val']?.value
    const lang: string = (r['val'] as { language?: string })?.language ?? r['val']?.lang ?? ''
    if (!classIri || !prop || val == null) continue
    if (!byClass.has(classIri)) byClass.set(classIri, new Map())
    const byProp = byClass.get(classIri)!
    const bucket = byProp.get(prop)
    if (bucket) bucket.push({ value: val, lang })
    else byProp.set(prop, [{ value: val, lang }])
  }

  // All queried IRIs get an entry (empty string = no description) so callers
  // can cache negatives and avoid redundant on-demand fetches.
  const result = new Map<string, string>(iris.map((iri) => [iri, '']))
  for (const [classIri, byProp] of byClass) {
    for (const propIri of DESCRIPTION_PROPERTIES) {
      const candidates = byProp.get(propIri)
      if (!candidates?.length) continue
      const best =
        candidates.find((c) => c.lang === language) ??
        candidates.find((c) => c.lang === 'en') ??
        candidates.find((c) => c.lang === '') ??
        candidates[0]
      if (best) {
        result.set(classIri, best.value)
        break
      }
    }
  }
  return result
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

async function fetchEdgesForClass(
  sourceIri: string,
  allClassIris: string[],
  context: QueryContext,
  store: Store | undefined,
  limit: number,
  signal?: AbortSignal,
): Promise<SchemaEdge[]> {
  const valuesClause = allClassIris.map((c) => `<${c}>`).join(' ')
  const query = `
    SELECT ?prop ?c2 (COUNT(*) AS ?n) WHERE {
      VALUES ?c2 { ${valuesClause} }
      ?s a <${sourceIri}> .
      ?s ?prop ?o .
      ?o a ?c2 .
      FILTER(?c2 != <${sourceIri}>)
    } GROUP BY ?prop ?c2
    ORDER BY DESC(?n)
    LIMIT ${limit}
  `
  const rows = await runSelect(query, context, store, signal)

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
  const {
    classLimit = 10,
    edgeLimit = 3,
    concurrency = 5,
    language = 'en',
    preloadedNodes,
    skipClasses,
    classOffset = 0,
    additionalClassIris,
  } = options

  // ── Phase 1: classes (skipped when resuming) ────────────────────────────────
  let nodes: SchemaNode[]
  if (preloadedNodes && preloadedNodes.length > 0) {
    nodes = preloadedNodes
    // Labels and onClassesLoaded already handled by the caller when restoring
  } else {
    nodes = await fetchSchemaClasses(context, store, classLimit, classOffset)
    if (signal?.aborted || nodes.length === 0) return { nodes, edges: [] }

    // Run all label + description batches concurrently (2 queries per batch in parallel).
    await Promise.all(
      chunk(
        nodes.map((n) => n.iri),
        20,
      ).map(async (batch) => {
        if (signal?.aborted) return
        const [labelMap, descMap] = await Promise.all([
          fetchLabels(batch, context, store),
          fetchDescriptionsBatch(batch, context, store, language).catch(
            () => new Map<string, string>(),
          ),
        ])
        if (signal?.aborted) return
        for (const node of nodes) {
          const entries = labelMap.get(node.iri)
          if (!entries?.length) continue
          const best = pickLabel(entries, language)
          if (best !== undefined) node.label = best
        }
        if (descMap.size > 0) callbacks.onDescriptionsLoaded?.(descMap)
      }),
    )
    callbacks.onClassesLoaded?.(nodes)
    if (signal?.aborted) return { nodes, edges: [] }
  }

  // ── Phase 2: edges ──────────────────────────────────────────────────────────
  // Include any extra IRIs (prior pages) so cross-batch edges are discovered.
  const allClassIris = additionalClassIris
    ? [...new Set([...nodes.map((n) => n.iri), ...additionalClassIris])]
    : nodes.map((n) => n.iri)
  const allEdges: SchemaEdge[] = []
  // Initialise counter at skip count so progress % is accurate when resuming
  let completed = skipClasses?.size ?? 0
  const queue = nodes.filter((n) => !skipClasses?.has(n.iri))

  if (queue.length === 0) return { nodes, edges: allEdges }

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) return
      const node = queue.shift()!
      try {
        const edges = await fetchEdgesForClass(
          node.iri,
          allClassIris,
          context,
          store,
          edgeLimit,
          signal,
        )
        if (!signal?.aborted && edges.length > 0) {
          allEdges.push(...edges)
          callbacks.onEdgesLoaded?.(edges)
        }
      } catch {
        // Partial schema is still useful — skip classes that time out
      }
      if (signal?.aborted) return
      callbacks.onProgress?.(++completed, nodes.length)
      callbacks.onClassProcessed?.(node.iri)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

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
      ?s a <${classIri}> .
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
