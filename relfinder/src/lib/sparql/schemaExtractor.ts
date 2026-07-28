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
import {
  RDF_TYPE,
  OWL_CLASS,
  RDFS_CLASS,
  RDFS_SUBCLASSOF,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  RDFS_DOMAIN,
  RDFS_RANGE,
} from './queryBuilder'

export interface SchemaExtractionOptions {
  /** Max classes to discover. Default 40. */
  classLimit?: number
  /** Max (prop, targetClass) rows per source class. Default 10. */
  edgeLimit?: number
  /** Max concurrent Phase-2 queries. Default 5. */
  concurrency?: number
  /**
   * Also discover classes explicitly declared as owl:Class or rdfs:Class,
   * even when no instances are typed with them. Default false — discovery is
   * purely instance-driven, so T-Box-only classes are invisible.
   */
  includeDeclaredClasses?: boolean
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
  /** Called once with declared rdfs:subClassOf edges between known classes. */
  onSubClassEdges?: (edges: SchemaEdge[]) => void
  /** Called once with declared object-property domain→range edges between known classes. */
  onDeclaredObjectEdges?: (edges: SchemaEdge[]) => void
  /** Called once with declared datatype properties grouped by their rdfs:domain class. */
  onDeclaredDataProps?: (byClass: Map<string, SchemaDataProp[]>) => void
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
  includeDeclaredClasses = false,
): Promise<SchemaNode[]> {
  // Instance-driven discovery: a class is anything something is typed with.
  const patterns = [`{ [] <${RDF_TYPE}> ?class . }`]
  if (includeDeclaredClasses) {
    // Declaration-driven discovery: also pick up T-Box classes with no instances.
    patterns.push(
      `{ ?class <${RDF_TYPE}> <${OWL_CLASS}> . }`,
      `{ ?class <${RDF_TYPE}> <${RDFS_CLASS}> . }`,
    )
  }
  const query = `
    SELECT DISTINCT ?class WHERE {
      ${patterns.join('\n      UNION\n      ')}
      FILTER(isIRI(?class))
    } ORDER BY ?class
    LIMIT ${limit}${offset > 0 ? `\n    OFFSET ${offset}` : ''}
  `
  const rows = await runSelect(query, context, store)
  return rows
    .filter((r) => r['class'])
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
      ?s <${RDF_TYPE}> <${sourceIri}> .
      ?s ?prop ?o .
      ?o <${RDF_TYPE}> ?c2 .
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

// ── Phase 1.5: declared (T-Box) relations ──────────────────────────────────────

/** All `?sub rdfs:subClassOf ?super` pairs where both ends are known classes. */
async function fetchSubClassEdges(
  classIris: string[],
  context: QueryContext,
  store: Store | undefined,
  signal?: AbortSignal,
): Promise<SchemaEdge[]> {
  if (classIris.length === 0) return []
  const values = classIris.map((c) => `<${c}>`).join(' ')
  const query = `
    SELECT DISTINCT ?sub ?super WHERE {
      VALUES ?sub { ${values} }
      VALUES ?super { ${values} }
      ?sub <${RDFS_SUBCLASSOF}> ?super .
      FILTER(?sub != ?super)
    }
  `
  const rows = await runSelect(query, context, store, signal)
  return rows
    .filter((r) => r['sub'] && r['super'])
    .map((r) => ({
      sourceIri: r['sub']!.value,
      targetIri: r['super']!.value,
      props: [{ iri: RDFS_SUBCLASSOF, label: 'subClassOf', count: 1 }],
      totalCount: 1,
      kind: 'subClassOf' as const,
    }))
}

/** Declared `?prop rdfs:domain ?d ; rdfs:range ?r` (owl:ObjectProperty) between known classes. */
async function fetchDeclaredObjectEdges(
  classIris: string[],
  context: QueryContext,
  store: Store | undefined,
  signal?: AbortSignal,
): Promise<SchemaEdge[]> {
  if (classIris.length === 0) return []
  const values = classIris.map((c) => `<${c}>`).join(' ')
  const query = `
    SELECT ?prop ?d ?r WHERE {
      VALUES ?d { ${values} }
      VALUES ?r { ${values} }
      ?prop <${RDF_TYPE}> <${OWL_OBJECT_PROPERTY}> ;
            <${RDFS_DOMAIN}> ?d ;
            <${RDFS_RANGE}> ?r .
    }
  `
  const rows = await runSelect(query, context, store, signal)
  // Collapse multiple properties for the same (domain, range) pair into one edge.
  const byPair = new Map<string, SchemaEdge>()
  for (const r of rows) {
    const propIri = r['prop']?.value
    const d = r['d']?.value
    const rr = r['r']?.value
    if (!propIri || !d || !rr) continue
    const entry: SchemaProp = { iri: propIri, label: shortIri(propIri), count: 1 }
    const edge = byPair.get(`${d} ${rr}`)
    if (edge) {
      edge.props.push(entry)
      edge.totalCount++
    } else {
      byPair.set(`${d} ${rr}`, {
        sourceIri: d,
        targetIri: rr,
        props: [entry],
        totalCount: 1,
        kind: 'objectDeclared',
      })
    }
  }
  return Array.from(byPair.values())
}

/** Declared datatype properties (owl:DatatypeProperty) grouped by their rdfs:domain class. */
async function fetchDeclaredDataProps(
  classIris: string[],
  context: QueryContext,
  store: Store | undefined,
  signal?: AbortSignal,
): Promise<Map<string, SchemaDataProp[]>> {
  if (classIris.length === 0) return new Map()
  const values = classIris.map((c) => `<${c}>`).join(' ')
  const query = `
    SELECT ?d ?prop ?r WHERE {
      VALUES ?d { ${values} }
      ?prop <${RDF_TYPE}> <${OWL_DATATYPE_PROPERTY}> ;
            <${RDFS_DOMAIN}> ?d .
      OPTIONAL { ?prop <${RDFS_RANGE}> ?r }
    }
  `
  const rows = await runSelect(query, context, store, signal)
  const byClass = new Map<string, Map<string, Set<string>>>()
  for (const r of rows) {
    const d = r['d']?.value
    const propIri = r['prop']?.value
    if (!d || !propIri) continue
    if (!byClass.has(d)) byClass.set(d, new Map())
    const byProp = byClass.get(d)!
    if (!byProp.has(propIri)) byProp.set(propIri, new Set())
    const rr = r['r']?.value
    if (rr) byProp.get(propIri)!.add(rr)
  }
  const result = new Map<string, SchemaDataProp[]>()
  for (const [classIri, byProp] of byClass) {
    result.set(
      classIri,
      Array.from(byProp.entries()).map(([iri, dts]) => ({
        iri,
        label: shortIri(iri),
        datatypes: [...dts].map(shortIri),
      })),
    )
  }
  return result
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
    includeDeclaredClasses = false,
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
    nodes = await fetchSchemaClasses(
      context,
      store,
      classLimit,
      classOffset,
      includeDeclaredClasses,
    )
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

  // Known class set — include any extra IRIs (prior pages) so cross-batch
  // relations are discovered. Shared by Phase 1.5 and Phase 2.
  const allClassIris = additionalClassIris
    ? [...new Set([...nodes.map((n) => n.iri), ...additionalClassIris])]
    : nodes.map((n) => n.iri)

  // ── Phase 1.5: declared (T-Box) relations — mined once from fresh discovery ──
  if (!preloadedNodes) {
    const subClassEdges = await fetchSubClassEdges(allClassIris, context, store, signal)
    if (!signal?.aborted && subClassEdges.length > 0) callbacks.onSubClassEdges?.(subClassEdges)

    const objectEdges = await fetchDeclaredObjectEdges(allClassIris, context, store, signal)
    if (!signal?.aborted && objectEdges.length > 0) callbacks.onDeclaredObjectEdges?.(objectEdges)

    const dataProps = await fetchDeclaredDataProps(allClassIris, context, store, signal)
    if (!signal?.aborted && dataProps.size > 0) callbacks.onDeclaredDataProps?.(dataProps)
  }
  if (signal?.aborted) return { nodes, edges: [] }

  // ── Phase 2: edges ──────────────────────────────────────────────────────────
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
