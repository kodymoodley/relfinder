/**
 * Class-pair discovery strategies.
 *
 * Each strategy is an async generator that yields DiscoveredPair objects as
 * they are found.  The RunQuery abstraction decouples query execution from the
 * strategy logic so the same code runs in two environments:
 *   - Web Worker mode  : RunQuery wraps a raw fetch against the SPARQL endpoint
 *   - Local-file mode  : RunQuery wraps Comunica's executeSelectOnStore
 */

import type { SparqlBinding, DiscoveredPair } from './types'

// ── Public interfaces ──────────────────────────────────────────────────────────

export type RunQuery = (query: string) => Promise<SparqlBinding[]>

export interface StrategyConfig {
  c1: string
  c2: string
  offset: number
  pairLimit: number
  /** Maximum intermediate nodes in the subgraph before discarding a pair. 0 = no check. */
  maxSubgraphNodes: number
  /** When non-empty, intermediate nodes must be instances of one of these types. */
  allowedIntermediateTypes: string[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Properties that connect entities via schema/ontology structure rather than
// meaningful domain-level relationships — excluded from path traversal.
const META = [
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'http://www.w3.org/2000/01/rdf-schema#subClassOf',
  'http://www.w3.org/2000/01/rdf-schema#domain',
  'http://www.w3.org/2000/01/rdf-schema#range',
  'http://www.w3.org/2002/07/owl#sameAs',
  'http://www.w3.org/2002/07/owl#equivalentClass',
].map(p => `<${p}>`).join(', ')

const META_FILTER = (v: string) => `FILTER(${v} NOT IN (${META}))`

const LABEL_OPT = (entityVar: string, labelVar: string) =>
  `OPTIONAL { ?${entityVar} <${RDFS_LABEL}> ?${labelVar} . FILTER(lang(?${labelVar}) = 'en' || lang(?${labelVar}) = '') }`

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Builds a VALUES+type triple that constrains ?nodeVar to the allowed types. */
function typeConstraint(nodeVar: string, bindVar: string, types: string[]): string {
  if (!types.length) return ''
  const vals = types.map((t) => `<${t}>`).join(' ')
  return `?${nodeVar} a ?${bindVar} . VALUES ?${bindVar} { ${vals} }`
}

function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}

function getLabel(row: SparqlBinding, labelKey: string, iriKey: string): string {
  return row[labelKey]?.value || shortIri(row[iriKey]?.value ?? '')
}

async function countSubgraphNodes(
  e1: string,
  e2: string,
  runQuery: RunQuery,
): Promise<number> {
  const q = `
    SELECT (COUNT(DISTINCT ?mid) AS ?n) WHERE {
      {
        <${e1}> ?p ?mid . ?mid ?q <${e2}> .
        FILTER(?mid != <${e1}> && ?mid != <${e2}>)
      } UNION {
        <${e2}> ?p ?mid . ?mid ?q <${e1}> .
        FILTER(?mid != <${e1}> && ?mid != <${e2}>)
      }
    }
  `
  try {
    const rows = await runQuery(q)
    return parseInt(rows[0]?.['n']?.value ?? '0', 10)
  } catch {
    return 0
  }
}

// ── Strategy: direct-1 (one-hop paths) ────────────────────────────────────────

export async function* strategyDirect1(
  cfg: StrategyConfig,
  runQuery: RunQuery,
): AsyncGenerator<DiscoveredPair> {
  const q = `
    SELECT DISTINCT ?e1 ?l1 ?p1 ?e2 ?l2 WHERE {
      ?e1 a <${cfg.c1}> . ?e2 a <${cfg.c2}> .
      ?e1 ?p1 ?e2 .
      ${META_FILTER('?p1')}
      FILTER(?e1 != ?e2)
      ${LABEL_OPT('e1', 'l1')}
      ${LABEL_OPT('e2', 'l2')}
    } LIMIT ${cfg.pairLimit * 4} OFFSET ${cfg.offset}
  `
  let found = 0
  const rows = await runQuery(q)
  for (const row of rows) {
    if (found >= cfg.pairLimit) return
    const e1 = row['e1']?.value, e2 = row['e2']?.value, p1 = row['p1']?.value
    if (!e1 || !e2 || !p1) continue
    found++
    yield {
      entity1: { iri: e1, label: getLabel(row, 'l1', 'e1') },
      entity2: { iri: e2, label: getLabel(row, 'l2', 'e2') },
      distance: 1,
      pathSketch: `→ ${shortIri(p1)} →`,
      strategy: 'direct-1',
    }
  }
}

// ── Strategy: direct-2 (two-hop paths) ────────────────────────────────────────

export async function* strategyDirect2(
  cfg: StrategyConfig,
  runQuery: RunQuery,
): AsyncGenerator<DiscoveredPair> {
  const midTypeClause = typeConstraint('mid', 'midT', cfg.allowedIntermediateTypes)
  const q = `
    SELECT DISTINCT ?e1 ?l1 ?p1 ?p2 ?e2 ?l2 WHERE {
      ?e1 a <${cfg.c1}> . ?e2 a <${cfg.c2}> .
      ?e1 ?p1 ?mid . ?mid ?p2 ?e2 .
      ${midTypeClause}
      ${META_FILTER('?p1')}
      ${META_FILTER('?p2')}
      FILTER(?e1 != ?e2 && ?mid != ?e1 && ?mid != ?e2)
      ${LABEL_OPT('e1', 'l1')}
      ${LABEL_OPT('e2', 'l2')}
    } LIMIT ${cfg.pairLimit * 4} OFFSET ${cfg.offset}
  `
  let found = 0
  const rows = await runQuery(q)
  for (const row of rows) {
    if (found >= cfg.pairLimit) return
    const e1 = row['e1']?.value, e2 = row['e2']?.value
    if (!e1 || !e2) continue
    const p1 = row['p1']?.value ?? '', p2 = row['p2']?.value ?? ''
    found++
    yield {
      entity1: { iri: e1, label: getLabel(row, 'l1', 'e1') },
      entity2: { iri: e2, label: getLabel(row, 'l2', 'e2') },
      distance: 2,
      pathSketch: `→ ${shortIri(p1)} → ● → ${shortIri(p2)} →`,
      strategy: 'direct-2',
    }
  }
}

// ── Strategy: anchor-3 (three-hop via anchored C1 instance) ───────────────────
//
// Anchoring one endpoint to a specific IRI prevents the three-way join from
// exploding on large datasets while still finding d=3 connections.

export async function* strategyAnchor3(
  cfg: StrategyConfig,
  runQuery: RunQuery,
): AsyncGenerator<DiscoveredPair> {
  const sampleRows = await runQuery(
    `SELECT ?e1 WHERE { ?e1 a <${cfg.c1}> } LIMIT 10 OFFSET ${cfg.offset * 10}`,
  )

  let found = 0

  for (const inst of sampleRows) {
    if (found >= cfg.pairLimit) return
    const e1Iri = inst['e1']?.value
    if (!e1Iri) continue

    // Small pause between anchor probes to avoid flooding rate-limited endpoints
    await sleep(150)

    const lRows = await runQuery(
      `SELECT ?l WHERE { <${e1Iri}> <${RDFS_LABEL}> ?l . FILTER(lang(?l) = 'en' || lang(?l) = '') } LIMIT 1`,
    )
    const e1Label = lRows[0]?.['l']?.value ?? shortIri(e1Iri)

    const m1TypeClause = typeConstraint('m1', 'm1T', cfg.allowedIntermediateTypes)
    const m2TypeClause = typeConstraint('m2', 'm2T', cfg.allowedIntermediateTypes)
    const probeRows = await runQuery(`
      SELECT DISTINCT ?e2 ?l2 ?p1 ?p2 ?p3 WHERE {
        ?e2 a <${cfg.c2}> .
        <${e1Iri}> ?p1 ?m1 . ?m1 ?p2 ?m2 . ?m2 ?p3 ?e2 .
        ${m1TypeClause}
        ${m2TypeClause}
        ${META_FILTER('?p1')}
        ${META_FILTER('?p2')}
        ${META_FILTER('?p3')}
        FILTER(?m1 != <${e1Iri}> && ?m2 != <${e1Iri}> && ?m1 != ?e2 && ?m2 != ?e2 && ?m1 != ?m2)
        ${LABEL_OPT('e2', 'l2')}
      } LIMIT 5
    `)

    for (const row of probeRows) {
      if (found >= cfg.pairLimit) return
      const e2 = row['e2']?.value
      if (!e2) continue

      if (cfg.maxSubgraphNodes > 0) {
        const size = await countSubgraphNodes(e1Iri, e2, runQuery)
        if (size > cfg.maxSubgraphNodes) continue
      }

      const p1 = row['p1']?.value ?? '', p2 = row['p2']?.value ?? '', p3 = row['p3']?.value ?? ''
      found++
      yield {
        entity1: { iri: e1Iri, label: e1Label },
        entity2: { iri: e2, label: getLabel(row, 'l2', 'e2') },
        distance: 3,
        pathSketch: `→ ${shortIri(p1)} → ● → ${shortIri(p2)} → ● → ${shortIri(p3)} →`,
        strategy: 'anchor-3',
      }
    }
  }
}
