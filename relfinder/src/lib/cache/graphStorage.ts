/**
 * Persistent cross-session cache for RelationshipGraph results.
 *
 * Storage layout (localStorage):
 *   rf:graph-index:v1          — lightweight index of all cached graphs (no graph data)
 *   rf:graph-data:v1:<id>      — serialized graph per entry
 *
 * The index and data are separated so listing recent entries is cheap and
 * individual entries can be evicted without reading the full dataset.
 *
 * TTL: 7 days. Limit: 20 entries per endpoint URL.
 */

import type {
  GraphNode,
  MergedEdge,
  LabelEntry,
  RelationshipGraph,
  EntitySearchResult,
} from '@/lib/sparql/types'

const VERSION = 1
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const HISTORY_LIMIT = 20
const INDEX_KEY = 'rf:graph-index:v1'
const DATA_KEY_PREFIX = 'rf:graph-data:v1:'

// ── Public types ──────────────────────────────────────────────────────────────

export interface GraphHistoryMeta {
  id: string
  endpointUrl: string
  savedAt: number
  entity1: EntitySearchResult
  entity2: EntitySearchResult
  maxDistance: number
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SerializedRelationshipGraph {
  nodes: GraphNode[]
  edges: MergedEdge[]
  classes: string[]
  allLabels: [string, LabelEntry[]][]
}

interface IndexStore {
  version: number
  entries: GraphHistoryMeta[]
}

// ── ID generation ─────────────────────────────────────────────────────────────

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function optionsSig(maxDistance: number, ignoredProperties: string[]): string {
  return `${maxDistance}|${[...ignoredProperties].sort().join(',')}`
}

export function makeGraphId(
  endpointUrl: string,
  e1Iri: string,
  e2Iri: string,
  maxDistance: number,
  ignoredProperties: string[],
): string {
  return djb2(
    endpointUrl + '|' + e1Iri + '|' + e2Iri + '|' + optionsSig(maxDistance, ignoredProperties),
  )
}

// ── Index read/write ──────────────────────────────────────────────────────────

function readIndex(): IndexStore {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return { version: VERSION, entries: [] }
    const parsed = JSON.parse(raw) as IndexStore
    if (parsed.version !== VERSION) return { version: VERSION, entries: [] }
    return parsed
  } catch {
    return { version: VERSION, entries: [] }
  }
}

function writeIndex(index: IndexStore): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // Silent degradation — index update lost, data may still be readable
  }
}

// ── Per-graph data read/write ─────────────────────────────────────────────────

function readGraphData(id: string): SerializedRelationshipGraph | null {
  try {
    const raw = localStorage.getItem(DATA_KEY_PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw) as SerializedRelationshipGraph
  } catch {
    return null
  }
}

function writeGraphData(id: string, data: SerializedRelationshipGraph): boolean {
  try {
    localStorage.setItem(DATA_KEY_PREFIX + id, JSON.stringify(data))
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') return false
    return false
  }
}

function removeGraphData(id: string): void {
  try {
    localStorage.removeItem(DATA_KEY_PREFIX + id)
  } catch {
    /* ignore */
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save a RelationshipGraph to localStorage.
 * If an identical entry (same endpoint + entities + options) already exists,
 * it is replaced and moved to the front of the list.
 * Returns the stable entry ID.
 */
export function saveGraph(
  endpointUrl: string,
  entity1: EntitySearchResult,
  entity2: EntitySearchResult,
  maxDistance: number,
  ignoredProperties: string[],
  graph: RelationshipGraph,
): string {
  const id = makeGraphId(endpointUrl, entity1.iri, entity2.iri, maxDistance, ignoredProperties)

  const serialized: SerializedRelationshipGraph = {
    nodes: graph.nodes,
    edges: graph.edges,
    classes: graph.classes,
    allLabels: Array.from(graph.allLabels.entries()),
  }

  const saved = writeGraphData(id, serialized)
  if (!saved) return id // quota exceeded — skip index update

  const index = readIndex()

  // Remove any existing entry with same id (will be re-inserted at front)
  const old = index.entries.find((e) => e.id === id)
  if (old) removeGraphData(old.id)
  index.entries = index.entries.filter((e) => e.id !== id)

  // Prepend new metadata
  const meta: GraphHistoryMeta = {
    id,
    endpointUrl,
    savedAt: Date.now(),
    entity1,
    entity2,
    maxDistance,
  }
  index.entries.unshift(meta)

  // Enforce per-endpoint limit
  const endpointEntries = index.entries.filter((e) => e.endpointUrl === endpointUrl)
  if (endpointEntries.length > HISTORY_LIMIT) {
    const toRemove = new Set(endpointEntries.slice(HISTORY_LIMIT).map((e) => e.id))
    for (const removeId of toRemove) removeGraphData(removeId)
    index.entries = index.entries.filter((e) => !toRemove.has(e.id))
  }

  writeIndex(index)
  return id
}

/**
 * Look up a cached graph by entity IRIs and options.
 * Returns null if not found or TTL expired.
 */
export function lookupGraph(
  endpointUrl: string,
  e1Iri: string,
  e2Iri: string,
  maxDistance: number,
  ignoredProperties: string[],
): RelationshipGraph | null {
  const id = makeGraphId(endpointUrl, e1Iri, e2Iri, maxDistance, ignoredProperties)
  return loadGraph(id)
}

/**
 * Load a cached graph by its stable entry ID.
 * Refreshes savedAt on hit so TTL restarts from last use.
 */
export function loadGraph(id: string): RelationshipGraph | null {
  const index = readIndex()
  const meta = index.entries.find((e) => e.id === id)
  if (!meta) return null

  if (Date.now() - meta.savedAt > TTL_MS) {
    deleteGraphEntry(id)
    return null
  }

  const data = readGraphData(id)
  if (!data) return null

  // Refresh TTL on access
  meta.savedAt = Date.now()
  writeIndex(index)

  return {
    nodes: data.nodes,
    edges: data.edges,
    classes: data.classes,
    allLabels: new Map(data.allLabels),
  }
}

/** Returns recent graph metadata for the given endpoint, newest first. */
export function listRecentGraphs(endpointUrl: string): GraphHistoryMeta[] {
  const now = Date.now()
  return readIndex().entries.filter(
    (e) => e.endpointUrl === endpointUrl && now - e.savedAt <= TTL_MS,
  )
}

/** Delete a single cached graph and its index entry. */
export function deleteGraphEntry(id: string): void {
  removeGraphData(id)
  const index = readIndex()
  index.entries = index.entries.filter((e) => e.id !== id)
  writeIndex(index)
}

/** Delete all cached graphs for an endpoint. */
export function clearAllGraphs(endpointUrl: string): void {
  const index = readIndex()
  const toRemove = index.entries.filter((e) => e.endpointUrl === endpointUrl)
  for (const entry of toRemove) removeGraphData(entry.id)
  index.entries = index.entries.filter((e) => e.endpointUrl !== endpointUrl)
  writeIndex(index)
}
