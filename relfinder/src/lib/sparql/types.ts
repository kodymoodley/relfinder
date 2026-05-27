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

export interface DataProperty {
  iri: string
  label: string
  value: string
}

// ── Schema graph ──────────────────────────────────────────────────────────────

export interface SchemaNode {
  iri: string
  label: string
}

/** A data (literal) property on a class, with its observed XSD datatypes. */
export interface SchemaDataProp {
  iri: string
  label: string
  datatypes: string[]
}

/** One property connecting two classes, with occurrence count. */
export interface SchemaProp {
  iri: string
  label: string
  count: number
}

/** All properties from one class to another, collapsed into a single directed edge. */
export interface SchemaEdge {
  sourceIri: string
  targetIri: string
  props: SchemaProp[]
  totalCount: number
}

export interface SchemaGraph {
  nodes: SchemaNode[]
  edges: SchemaEdge[]
}

// ── Engine context ────────────────────────────────────────────────────────────

/**
 * Everything the Comunica engine needs to execute queries against a source.
 * Constructed from the Pinia connection store and passed into lib functions.
 */
export interface QueryContext {
  /**
   * Effective SPARQL endpoint URL. For transparent proxies (Caddy) this is
   * the proxy URL; for direct connections or Vercel proxies it is the real
   * endpoint URL.
   */
  endpointUrl: string
  /** Pre-encoded 'Basic <base64>' header value, or undefined if no auth. */
  authorizationHeader?: string
  /**
   * Base URL of the Vercel /api/sparql proxy function. When set, all
   * fetch requests to `endpointUrl` are rewritten so that `endpoint` is
   * passed as a query parameter and the actual fetch targets the proxy.
   * Required because the Vercel function is a custom forwarder, not a
   * transparent HTTP proxy.
   */
  proxyBaseUrl?: string
}
