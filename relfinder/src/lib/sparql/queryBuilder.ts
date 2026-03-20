/**
 * SPARQL query builder for relationship path-finding.
 *
 * Ported from the Python modules:
 *   - relfinder-api/api/helpers/sparql/query_utils.py
 *   - relfinder-api/api/helpers/sparql/relationships.py
 *
 * All functions are pure (no I/O, no side effects) and operate solely
 * on strings and plain objects. This makes them straightforward to unit-test.
 */

import {
  QueryCyclesStrategy,
  RelationshipDirection,
  type RelationshipQueryConfig,
  type QueryBlock,
} from './types'

// ── IRI prefix utilities ──────────────────────────────────────────────────────

/**
 * Well-known Linked Data prefixes included by default in every generated query.
 * The original Python code included a domain-specific `cbcm` prefix; that has
 * been replaced with broader Linked Data standards.
 *
 * Keys are the short prefix, values are the namespace IRI.
 */
export const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  schema: 'https://schema.org/',
  db: 'http://dbpedia.org/resource/',
  dbo: 'http://dbpedia.org/ontology/',
  dbp: 'http://dbpedia.org/property/',
  wd: 'http://www.wikidata.org/entity/',
}

/**
 * Converts a full IRI to its prefixed form if a known prefix matches,
 * or wraps it in angle brackets otherwise.
 *
 * Examples:
 *   uri('http://www.w3.org/2000/01/rdf-schema#label')  → 'rdfs:label'
 *   uri('http://example.org/foo')                       → '<http://example.org/foo>'
 *   uri('rdfs:label')                                   → 'rdfs:label'  (already prefixed)
 */
export function uri(iri: string, prefixes: Record<string, string> = DEFAULT_PREFIXES): string {
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (iri.startsWith(namespace)) {
      return iri.replace(namespace, `${prefix}:`)
    }
  }

  // Already prefixed (contains ':' and the part before it is a known prefix)
  if (iri.includes(':')) {
    const candidate = iri.slice(0, iri.indexOf(':'))
    if (candidate in prefixes) {
      return iri
    }
  }

  return `<${iri}>`
}

/**
 * Generates a SPARQL triple pattern in the form `?s ?p ?o .`
 * When `toObject` is false the subject and object are swapped: `?o ?p ?s .`
 */
export function toPattern(
  subject: string,
  property: string,
  object: string,
  toObject: boolean,
): string {
  return toObject
    ? `${subject} ${property} ${object} . \n`
    : `${object} ${property} ${subject} . \n`
}

/**
 * Joins an array of filter terms with `operator` and wraps the result
 * in outer parentheses.
 *
 * Example: expandTerms(['(a)', '(b)'], '&&') → '((a)\n &&\n(b)\n)'
 */
export function expandTerms(terms: string[], operator = '&&'): string {
  if (terms.length === 0) return '()'

  const inner = terms
    .map((t, i) => `(${t})${i < terms.length - 1 ? ` ${operator} ` : ''}\n`)
    .join('')

  return `(${inner})`
}

// ── Filter generation ─────────────────────────────────────────────────────────

/**
 * Generates the FILTER clause for a query, encoding:
 *  - Ignored property exclusions
 *  - Literal object exclusions (intermediate nodes must be IRIs)
 *  - Ignored object exclusions
 *  - Cycle avoidance (prevents intermediate nodes from equalling either endpoint,
 *    and optionally prevents duplicates within the same path)
 *
 * `variables` has the form:
 *   { pred: ['?pf1', ...], obj: ['?of1', ...] }
 */
export function generateFilter(
  queryConfig: RelationshipQueryConfig,
  variables: { pred: string[]; obj: string[] },
): string {
  const filterTerms: string[] = []

  for (const prop of variables.pred) {
    for (const ignoredProp of queryConfig.ignoredProperties) {
      filterTerms.push(`${prop} != ${uri(ignoredProp)} `)
    }
  }

  for (const obj of variables.obj) {
    // Intermediate nodes must be IRIs, not literals
    filterTerms.push(`!isLiteral(${obj})`)

    for (const ignoredObj of queryConfig.ignoredObjects) {
      filterTerms.push(`${obj} != ${uri(ignoredObj)} `)
    }

    if (queryConfig.avoidCycles !== QueryCyclesStrategy.NONE) {
      const e1 = uri(queryConfig.entity1IRI)
      const e2 = uri(queryConfig.entity2IRI)

      filterTerms.push(`${obj} != ${e1} `)
      filterTerms.push(`${obj} != ${e2} `)

      if (queryConfig.avoidCycles === QueryCyclesStrategy.NO_INTERMEDIATE_DUPLICATES) {
        for (const otherObj of variables.obj) {
          if (obj !== otherObj) {
            filterTerms.push(`${obj} != ${otherObj} `)
          }
        }
      }
    }
  }

  const expanded = expandTerms(filterTerms, '&&')
  return `FILTER ${expanded}. `
}

// ── Query assembly ────────────────────────────────────────────────────────────

/**
 * Wraps a core WHERE-clause pattern with PREFIX declarations, SELECT, and FILTER.
 */
export function completeQuery(
  queryConfig: RelationshipQueryConfig,
  coreQuery: string,
  variables: { pred: string[]; obj: string[] },
  prefixes: Record<string, string> = DEFAULT_PREFIXES,
): string {
  const prefixLines = Object.entries(prefixes)
    .map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
    .join('\n')

  const filter = generateFilter(queryConfig, variables)

  return `${prefixLines}\nSELECT * WHERE {\n${coreQuery}\n${filter}\n}`
}

// ── Direct path queries ───────────────────────────────────────────────────────

/**
 * Generates a query for a direct (linear) path between the two entities.
 *
 * For distance 1:   entity1 ?pf1 entity2
 * For distance 2:   entity1 ?pf1 ?of1 . ?of1 ?pf2 entity2
 * For distance n:   entity1 ?pf1 ?of1 . ?of1 ?pf2 ?of2 . ... ?of(n-1) ?pfn entity2
 *
 * `direction` controls which entity is the source.
 */
export function direct(
  queryConfig: RelationshipQueryConfig,
  distance: number,
  direction: RelationshipDirection = RelationshipDirection.FORWARD,
): string {
  let entity1IRI: string
  let entity2IRI: string

  if (direction === RelationshipDirection.FORWARD) {
    entity1IRI = queryConfig.entity1IRI
    entity2IRI = queryConfig.entity2IRI
  } else {
    entity1IRI = queryConfig.entity2IRI
    entity2IRI = queryConfig.entity1IRI
  }

  const variables: { pred: string[]; obj: string[] } = { pred: [], obj: [] }

  if (distance === 1) {
    variables.pred.push('?pf1')
    return completeQuery(
      queryConfig,
      `${uri(entity1IRI)} ?pf1 ${uri(entity2IRI)}`,
      variables,
    )
  }

  let coreQuery = `${uri(entity1IRI)} ?pf1 ?of1 .\n`
  variables.pred.push('?pf1')
  variables.obj.push('?of1')

  for (let i = 1; i < distance - 1; i++) {
    const prop = `?pf${i + 1}`
    const obj1 = `?of${i}`
    const obj2 = `?of${i + 1}`

    coreQuery += `${obj1} ${prop} ${obj2}.\n`
    variables.pred.push(prop)
    variables.obj.push(obj2)
  }

  coreQuery += `?of${distance - 1} ?pf${distance} ${uri(entity2IRI)}`
  variables.pred.push(`?pf${distance}`)

  return completeQuery(queryConfig, coreQuery, variables)
}

// ── Middle-object path queries ────────────────────────────────────────────────

/**
 * Helper that appends triple patterns from `object` → `?middle`
 * (or the reverse when `toObject` is false) onto `coreQuery`.
 *
 * Returns the extended query string and the new variable names introduced.
 *
 * @param fs  Variable name prefix ('f' for first entity, 's' for second).
 */
function generateMiddleObjectQuery(
  coreQuery: string,
  object: string,
  distance: number,
  fs: string,
  toObject: boolean,
): [string, { pred: string[]; obj: string[] }] {
  const variables: { pred: string[]; obj: string[] } = { pred: [], obj: [] }

  if (distance === 1) {
    coreQuery += toPattern(uri(object), `?p${fs}1`, '?middle', toObject)
    variables.pred.push(`?p${fs}1`)
  } else {
    coreQuery += toPattern(uri(object), `?p${fs}1`, `?o${fs}1`, toObject)
    variables.pred.push(`?p${fs}1`)

    for (let x = 1; x < distance; x++) {
      const subject = `?o${fs}${x}`
      const prop = `?p${fs}${x + 1}`

      variables.obj.push(subject)
      variables.pred.push(prop)

      if (x + 1 === distance) {
        coreQuery += toPattern(subject, prop, '?middle', toObject)
      } else {
        coreQuery += toPattern(subject, prop, `?o${fs}${x + 1}`, toObject)
      }
    }
  }

  return [coreQuery, variables]
}

/**
 * Generates a query for paths that meet at a shared intermediate node
 * (`?middle`).
 *
 * When `toObject` is true:   first → ... → ?middle ← ... ← second
 * When `toObject` is false:  first ← ... ← ?middle → ... → second
 *
 * @param dist1  Hop distance from `first` to `?middle`.
 * @param dist2  Hop distance from `second` to `?middle`.
 */
export function middleObjectQuery(
  first: string,
  second: string,
  dist1: number,
  dist2: number,
  toObject: boolean,
  queryConfig: RelationshipQueryConfig,
): QueryBlock {
  if (dist1 < 1) throw new RangeError('dist1 must be >= 1')
  if (dist2 < 1) throw new RangeError('dist2 must be >= 1')

  const variables: { pred: string[]; obj: string[] } = {
    pred: [],
    obj: ['?middle'],
  }

  let coreQuery = ''

  const [q1, firstVars] = generateMiddleObjectQuery(coreQuery, first, dist1, 'f', toObject)
  const [q2, secondVars] = generateMiddleObjectQuery(q1, second, dist2, 's', toObject)
  coreQuery = q2

  variables.pred.push(...firstVars.pred, ...secondVars.pred)
  variables.obj.push(...firstVars.obj, ...secondVars.obj)

  return {
    query: completeQuery(queryConfig, coreQuery, variables),
    src: first,
    dest: second,
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generates the complete set of SPARQL SELECT queries needed to find all
 * relationship paths between `entity1IRI` and `entity2IRI` up to
 * `maxDistance` hops.
 *
 * Returns a map of distance → QueryBlock[]. Each QueryBlock contains the
 * query string plus the (src, dest) IRI pair it corresponds to — needed by
 * the graph builder to correctly orient the resulting edges.
 *
 * This is the TypeScript port of `get_queries()` from relationships.py.
 */
export function getQueries(queryConfig: RelationshipQueryConfig): Map<number, QueryBlock[]> {
  const queries = new Map<number, QueryBlock[]>()

  for (let distance = 1; distance <= queryConfig.maxDistance; distance++) {
    const blocks: QueryBlock[] = []

    // Direct paths in both directions
    blocks.push({
      query: direct(queryConfig, distance, RelationshipDirection.FORWARD),
      src: queryConfig.entity1IRI,
      dest: queryConfig.entity2IRI,
    })

    blocks.push({
      query: direct(queryConfig, distance, RelationshipDirection.BACKWARD),
      src: queryConfig.entity2IRI,
      dest: queryConfig.entity1IRI,
    })

    // Middle-object paths: all (a, b) pairs where a + b === distance
    for (let a = 1; a <= distance; a++) {
      for (let b = 1; b <= distance; b++) {
        if (a + b === distance) {
          blocks.push(
            middleObjectQuery(
              queryConfig.entity1IRI,
              queryConfig.entity2IRI,
              a,
              b,
              true,
              queryConfig,
            ),
          )

          blocks.push(
            middleObjectQuery(
              queryConfig.entity1IRI,
              queryConfig.entity2IRI,
              a,
              b,
              false,
              queryConfig,
            ),
          )
        }
      }
    }

    queries.set(distance, blocks)
  }

  return queries
}
