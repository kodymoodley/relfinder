/**
 * Shared TypeScript types for the RelFinder SPARQL library layer.
 *
 * These types are ported from the Python structs (structs.py) and
 * endpoint data models in the original relfinder-api.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum QueryCyclesStrategy {
  /** No cycle avoidance — intermediate nodes may repeat. */
  NONE = 'NONE',
  /**
   * Prevents any intermediate node from appearing more than once in
   * a single path. This is the recommended default.
   */
  NO_INTERMEDIATE_DUPLICATES = 'NO_INTERMEDIATE_DUPLICATES',
}

export enum RelationshipDirection {
  /** entity1 → entity2 */
  FORWARD = 'FORWARD',
  /** entity2 → entity1 */
  BACKWARD = 'BACKWARD',
}

// ── Query configuration ────────────────────────────────────────────────────────

export interface RelationshipQueryConfig {
  entity1IRI: string
  entity2IRI: string
  /** Object IRIs that should not appear as intermediate nodes. */
  ignoredObjects: string[]
  /** Property IRIs that should not appear as path edges. */
  ignoredProperties: string[]
  avoidCycles: QueryCyclesStrategy
  maxDistance: number
  /**
   * Whitelist of object property IRIs that may appear as graph edges.
   * An empty array means all properties are permitted — recommended
   * for general-purpose use.
   */
  allowedObjectProperties: string[]
}

// ── SPARQL result types ────────────────────────────────────────────────────────

/** A single variable binding as returned by a SPARQL SELECT query. */
export interface SparqlTerm {
  value: string
  /** RDF.js term type: NamedNode | BlankNode | Literal */
  type: string
  /** Language tag, present on Literals only. */
  lang?: string
}

/** A row of bindings keyed by variable name (without the leading '?'). */
export type SparqlBinding = Record<string, SparqlTerm>

// ── Query building types ───────────────────────────────────────────────────────

/** A generated SPARQL SELECT string together with its source/destination IRIs. */
export interface QueryBlock {
  query: string
  /** IRI of the source entity for this query. */
  src: string
  /** IRI of the destination entity for this query. */
  dest: string
}

/**
 * A collection of SPARQL result rows for a single (src, dest) query.
 * Multiple QueryBlocks are generated per distance level.
 */
export interface PathCollection {
  src: string
  dest: string
  paths: SparqlBinding[]
}

// ── Label model ───────────────────────────────────────────────────────────────

/** A single label value paired with its RDF language tag ('' = untagged). */
export interface LabelEntry {
  value: string
  lang: string
}

// ── Graph model ───────────────────────────────────────────────────────────────

export interface GraphNode {
  /** Stable integer identifier used by edges. */
  id: number
  iri: string
  /** Human-readable label (rdfs:label if available, IRI fragment otherwise). */
  label: string
  /** rdf:type IRI of the node. */
  class: string
  /** True for the two entities the user originally searched for. */
  isEndpoint: boolean
}

export interface GraphEdge {
  /** Source node id. */
  sid: number
  /** Target node id. */
  tid: number
  /** Property IRI. */
  iri: string
  label: string
}

/**
 * A deduplicated edge that may represent multiple parallel properties
 * between the same pair of nodes.
 */
export interface MergedEdge {
  sid: number
  tid: number
  iris: string[]
  /** Labels joined by ' | '. */
  label: string
}

export interface RelationshipGraph {
  nodes: GraphNode[]
  edges: MergedEdge[]
  /** Distinct rdf:type IRIs present in the graph — used to colour nodes. */
  classes: string[]
  /**
   * All label values fetched for every node and edge IRI, keyed by IRI.
   * Stored so that a language change can re-apply labels client-side
   * without re-running the path traversal queries.
   */
  allLabels: Map<string, LabelEntry[]>
}

// ── Entity search ─────────────────────────────────────────────────────────────

export interface EntitySearchResult {
  iri: string
  label: string
  class: string
}

export interface ClassInfo {
  iri: string
  /** Short display name derived from the IRI fragment or last path segment. */
  label: string
  /** Approximate instance count — omitted when the endpoint can't aggregate quickly. */
  count?: number
}

export interface DataProperty {
  iri: string
  label: string
  value: string
}

// ── Class pair discovery ───────────────────────────────────────────────────────

export interface DiscoveredPair {
  entity1: { iri: string; label: string }
  entity2: { iri: string; label: string }
  /** Number of hops between the two entities. */
  distance: number
  /** Human-readable description of the connecting path, e.g. "→ schema:author → ● → schema:member →". */
  pathSketch: string
  /** Which strategy produced this pair. */
  strategy: string
}

export type ClassPairStrategy = 'direct-1' | 'direct-2' | 'anchor-3'

export interface ClassPairWorkerInput {
  type: 'start'
  strategy: ClassPairStrategy
  c1: string
  c2: string
  endpointUrl: string
  authorizationHeader?: string
  offset: number
  pairLimit: number
  maxSubgraphNodes: number
  /** When non-empty, intermediate nodes must be instances of one of these types. */
  allowedIntermediateTypes: string[]
}

export type ClassPairWorkerOutput =
  | { type: 'pair'; pair: DiscoveredPair }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ── Engine context ────────────────────────────────────────────────────────────

/**
 * Everything the Comunica engine needs to execute queries against a source.
 * Constructed from the Pinia connection store and passed into lib functions.
 */
export interface QueryContext {
  /**
   * Effective SPARQL endpoint URL. When the user has configured a CORS
   * proxy, this should be the proxy URL (e.g. http://localhost:8080/sparql)
   * rather than the raw endpoint, because the proxy IS the endpoint from
   * the browser's perspective.
   */
  endpointUrl: string
  /** Pre-encoded 'Basic <base64>' header value, or undefined if no auth. */
  authorizationHeader?: string
}
