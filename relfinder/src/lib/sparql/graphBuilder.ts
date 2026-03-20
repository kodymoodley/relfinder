/**
 * Graph assembly — converts raw SPARQL binding rows into a typed node/edge graph.
 *
 * Ported from the private methods of `SPARQLEndpoint` in:
 *   relfinder-api/api/helpers/sparql/endpoint.py
 *
 * All functions are pure (no I/O). The `engine.ts` module is responsible
 * for executing the queries; this module only interprets the results.
 */

import type {
  SparqlBinding,
  PathCollection,
  GraphNode,
  GraphEdge,
  MergedEdge,
  RelationshipGraph,
} from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when a SPARQL variable name represents an intermediate object
 * node (i.e. `?of1`, `?of2`, `?middle`, `?os1`, `?os2`, …).
 *
 * Mirrors `__is_path_object` from endpoint.py.
 */
function isPathObject(key: string): boolean {
  return key.includes('of') || key === 'middle' || key.includes('os')
}

/**
 * Returns true when every property in the path belongs to the
 * `allowedObjectProperties` whitelist.
 *
 * If the whitelist is empty, all properties are permitted — this is the
 * recommended default for general-purpose use.
 *
 * Mirrors `__is_prop_chain_valid` from endpoint.py.
 */
function isPropChainValid(path: SparqlBinding, allowedObjectProperties: string[]): boolean {
  if (allowedObjectProperties.length === 0) return true

  const propertyIris = Object.keys(path)
    .filter((k) => k.startsWith('pf') || k.startsWith('ps'))
    .map((k) => path[k]!.value)

  return propertyIris.every((iri) => allowedObjectProperties.includes(iri))
}

// ── Node extraction ───────────────────────────────────────────────────────────

/**
 * Scans all path binding rows and builds a map of { entityIRI → numericId }.
 * The two endpoint entities are always assigned ids 0 and 1.
 *
 * Mirrors `__extract_relationship_nodes` from endpoint.py.
 */
function extractRelationshipNodes(
  src: string,
  dest: string,
  pathCollections: PathCollection[],
): Map<string, number> {
  const nodes = new Map<string, number>([[src, 0], [dest, 1]])
  let nodeIdx = 2

  for (const collection of pathCollections) {
    for (const path of collection.paths) {
      for (const key of Object.keys(path)) {
        if (!isPathObject(key)) continue

        // `noUncheckedIndexedAccess` makes path[key] potentially undefined;
        // the key comes from Object.keys() so it always exists at runtime.
        const term = path[key]
        if (!term) continue

        if (!nodes.has(term.value)) {
          nodes.set(term.value, nodeIdx++)
        }
      }
    }
  }

  return nodes
}

// ── Edge extraction ───────────────────────────────────────────────────────────

/**
 * Converts a sorted list of forward props into a sequence of edges,
 * following intermediate objects (`?of1`, `?of2`, …) or `?middle`.
 *
 * Mirrors `__path_to_edges` from endpoint.py.
 *
 * @param objectKeyPrefix  'of' for forward chains, 'os' for backward chains.
 */
function pathToEdges(
  src: string,
  dest: string,
  props: string[],
  path: SparqlBinding,
  nodes: Map<string, number>,
  objectKeyPrefix: string,
): GraphEdge[] {
  const edges: GraphEdge[] = []
  let currentPos = src

  for (let idx = 0; idx < props.length; idx++) {
    // `noUncheckedIndexedAccess` makes array indexing return T | undefined.
    // props comes from filtered Object.keys() so these are safe at runtime.
    const prop = props[idx]!
    const propTerm = path[prop]
    if (!propTerm) continue

    const propIri = propTerm.value
    const propLabel = propIri.split('/').pop() ?? propIri
    const targetObj = `${objectKeyPrefix}${idx + 1}`

    if (targetObj in path) {
      // Inside this block path[targetObj] exists at runtime — safe to assert.
      const objIri = path[targetObj]!.value

      edges.push({
        sid: nodes.get(objIri)!,
        tid: nodes.get(currentPos)!,
        iri: propIri,
        label: propLabel,
      })

      currentPos = objIri
    } else if ('middle' in path) {
      const middleIri = path['middle']!.value

      edges.push({
        sid: nodes.get(middleIri)!,
        tid: nodes.get(currentPos)!,
        iri: propIri,
        label: propLabel,
      })
      // No more connections after meeting ?middle
      break
    } else {
      // Terminal hop — connect to destination
      edges.push({
        sid: nodes.get(currentPos)!,
        tid: nodes.get(dest)!,
        iri: propIri,
        label: propLabel,
      })
    }
  }

  return edges
}

/**
 * Decomposes a single multi-hop binding row into its constituent forward
 * and backward edges.
 *
 * Mirrors `__extract_path_edges` from endpoint.py.
 */
function extractPathEdges(
  src: string,
  dest: string,
  path: SparqlBinding,
  nodes: Map<string, number>,
): GraphEdge[] {
  const forwardProps = Object.keys(path)
    .filter((k) => k.startsWith('pf'))
    .sort()

  const backwardProps = Object.keys(path)
    .filter((k) => k.startsWith('ps'))
    .sort()

  const forwardEdges = pathToEdges(src, dest, forwardProps, path, nodes, 'of')
  const backwardEdges = pathToEdges(dest, src, backwardProps, path, nodes, 'os')

  return [...forwardEdges, ...backwardEdges]
}

/**
 * Iterates over all path collections and produces a deduplicated list of edges.
 *
 * Mirrors `__extract_relationship_edges` from endpoint.py.
 */
function extractRelationshipEdges(
  pathCollections: PathCollection[],
  nodes: Map<string, number>,
  allowedObjectProperties: string[],
): GraphEdge[] {
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  for (const collection of pathCollections) {
    for (const path of collection.paths) {
      const pathKeys = Object.keys(path)

      if (pathKeys.length === 1) {
        // Direct single-hop connection — pathKeys[0] exists (length === 1).
        const propIri = path[pathKeys[0]!]!.value

        if (
          allowedObjectProperties.length > 0 &&
          !allowedObjectProperties.includes(propIri)
        ) {
          continue
        }

        const edge: GraphEdge = {
          sid: nodes.get(collection.src)!,
          tid: nodes.get(collection.dest)!,
          iri: propIri,
          label: propIri.split('/').pop() ?? propIri,
        }

        const key = JSON.stringify(edge)
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push(edge)
        }
      } else {
        if (!isPropChainValid(path, allowedObjectProperties)) continue

        for (const edge of extractPathEdges(
          collection.src,
          collection.dest,
          path,
          nodes,
        )) {
          const key = JSON.stringify(edge)
          if (!edgeSet.has(key)) {
            edgeSet.add(key)
            edges.push(edge)
          }
        }
      }
    }
  }

  return edges
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merges parallel edges (same sid/tid pair) into a single edge whose `label`
 * is the pipe-separated concatenation of all individual property labels.
 *
 * Mirrors `merge_edge_duplicates` from endpoint.py.
 */
export function mergeEdgeDuplicates(edges: GraphEdge[], labelSep = '|'): MergedEdge[] {
  const edgesMap = new Map<string, MergedEdge>()

  for (const edge of edges) {
    const key = `${edge.sid}-${edge.tid}`
    const existing = edgesMap.get(key)

    if (existing) {
      if (!existing.iris.includes(edge.iri)) {
        existing.iris.push(edge.iri)
        existing.label = existing.iris
          .map((iri) => iri.split('/').pop() ?? iri)
          .join(` ${labelSep} `)
      }
    } else {
      edgesMap.set(key, {
        sid: edge.sid,
        tid: edge.tid,
        iris: [edge.iri],
        label: edge.label,
      })
    }
  }

  return Array.from(edgesMap.values())
}

/**
 * Main entry point: assembles a `RelationshipGraph` from raw SPARQL
 * path collections.
 *
 * Mirrors `_build_relationships_graph` from endpoint.py.
 *
 * @param allowedObjectProperties  IRIs of permitted edge properties.
 *   Pass an empty array to allow all properties (general-purpose default).
 */
export function buildRelationshipsGraph(
  src: string,
  dest: string,
  pathCollections: PathCollection[],
  allowedObjectProperties: string[] = [],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = extractRelationshipNodes(src, dest, pathCollections)
  const rawEdges = extractRelationshipEdges(pathCollections, nodeMap, allowedObjectProperties)

  const nodes: GraphNode[] = Array.from(nodeMap.entries()).map(([iri, id]) => ({
    id,
    iri,
    label: iri.split('/').pop()?.split('#').pop() ?? iri,
    class: 'Thing',
    isEndpoint: iri === src || iri === dest,
  }))

  return { nodes, edges: rawEdges }
}

/**
 * Applies `rdfs:label` and `rdf:type` lookups to nodes and edges in-place.
 *
 * This is called after `buildRelationshipsGraph` and after the label/type
 * maps have been fetched from the endpoint by `entitySearch.ts`.
 *
 * Mirrors `add_type_label` from relfinder-api/api/helpers/sparql/__init__.py.
 */
export function applyLabelsAndTypes(
  nodes: GraphNode[],
  edges: { iri: string; label: string }[],
  labelsMap: Map<string, string>,
  typesMap: Map<string, string>,
): void {
  for (const node of nodes) {
    const label = labelsMap.get(node.iri)
    if (label) node.label = label

    const type = typesMap.get(node.iri)
    node.class = type ?? 'Thing'
  }

  for (const edge of edges) {
    const label = labelsMap.get(edge.iri)
    if (label) edge.label = label
  }
}
