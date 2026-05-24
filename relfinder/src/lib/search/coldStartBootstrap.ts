import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'
import type { CachedEntity } from './types'
import { cacheHas, cacheAdd } from './entityCache'

// ── Constants ─────────────────────────────────────────────────────────────────

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'
const CHUNK_SIZE = 500

// ── Idle-time scheduling ──────────────────────────────────────────────────────

const _idle: (fn: () => void) => void =
  typeof requestIdleCallback !== 'undefined'
    ? (fn) => requestIdleCallback(fn, { timeout: 5_000 })
    : (fn) => setTimeout(fn, 0)

function processInChunks(entities: CachedEntity[]): void {
  let offset = 0
  function next() {
    const chunk = entities.slice(offset, offset + CHUNK_SIZE)
    if (chunk.length === 0) return
    cacheAdd(chunk)
    offset += CHUNK_SIZE
    if (offset < entities.length) _idle(next)
  }
  _idle(next)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seeds the entity cache (and by extension the search index, via hooks.onAdd)
 * from the schema currently loaded in the schema store. Entities already
 * present in the cache are skipped. Runs in idle-time chunks to keep the
 * main thread responsive during large schema loads.
 *
 * Call once after the first schema load (nodes.length 0 → N).
 */
export function bootstrapFromSchema(
  nodes: SchemaNode[],
  edges: SchemaEdge[],
  instancesCache: Map<string, Array<{ iri: string; label: string }>>,
): void {
  const now = Date.now()
  const entities: CachedEntity[] = []

  const classLabelMap = new Map(nodes.map((n) => [n.iri, n.label]))

  // 1. Schema classes
  for (const node of nodes) {
    if (cacheHas(node.iri)) continue
    entities.push({
      iri: node.iri,
      label: node.label,
      altLabels: [],
      classIri: OWL_CLASS,
      classLabel: 'Class',
      description: '',
      addedAt: now,
      lastAccessed: now,
    })
  }

  // 2. Object properties (deduplicated across all edges)
  const seenProps = new Set<string>()
  for (const edge of edges) {
    for (const prop of edge.props) {
      if (seenProps.has(prop.iri) || cacheHas(prop.iri)) continue
      seenProps.add(prop.iri)
      entities.push({
        iri: prop.iri,
        label: prop.label,
        altLabels: [],
        classIri: OWL_OBJECT_PROPERTY,
        classLabel: 'Object Property',
        description: '',
        addedAt: now,
        lastAccessed: now,
      })
    }
  }

  // 3. Known instances from the instances panel cache
  for (const [classIri, instances] of instancesCache) {
    const classLabel = classLabelMap.get(classIri) ?? 'Unknown'
    for (const inst of instances) {
      if (cacheHas(inst.iri)) continue
      entities.push({
        iri: inst.iri,
        label: inst.label,
        altLabels: [],
        classIri,
        classLabel,
        description: '',
        addedAt: now,
        lastAccessed: now,
      })
    }
  }

  if (entities.length === 0) return
  processInChunks(entities)
}
