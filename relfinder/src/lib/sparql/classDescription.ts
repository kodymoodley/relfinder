/**
 * Fetches a human-readable description for a class IRI.
 *
 * A single SPARQL VALUES query fetches candidates from all supported
 * description properties in one round-trip. The best match is then
 * selected client-side using the priority order below, preferring the
 * user's language, then English, then untagged, then any language.
 */

import { SparqlClient } from './client'

// Priority order: most precise/standard first, dataset-specific last.
export const DESCRIPTION_PROPERTIES = [
  'http://www.w3.org/2000/01/rdf-schema#comment',
  'http://www.w3.org/2004/02/skos/core#definition',
  'http://dbpedia.org/ontology/abstract',
  'https://schema.org/description',
  'http://purl.org/dc/terms/description',
  'http://dbpedia.org/ontology/description',
  'http://dbpedia.org/property/description',
  'http://www.w3.org/2004/02/skos/core#note',
  'http://xmlns.com/foaf/0.1/bio',
] as const

export async function fetchClassDescription(
  classIri: string,
  client: SparqlClient,
  language = 'en',
): Promise<string> {
  const valuesClause = DESCRIPTION_PROPERTIES.map((p) => `<${p}>`).join(' ')
  const query = `
    SELECT ?prop ?val WHERE {
      VALUES ?prop { ${valuesClause} }
      <${classIri}> ?prop ?val .
      FILTER(isLiteral(?val))
    }
  `
  const rows = await client.select(query)
  if (rows.length === 0) return ''

  // Group by property IRI, collecting all (value, lang) pairs
  const byProp = new Map<string, { value: string; lang: string }[]>()
  for (const r of rows) {
    const prop = r['prop']?.value
    const val = r['val']?.value
    const lang: string = (r['val'] as { language?: string })?.language ?? r['val']?.lang ?? ''
    if (!prop || val == null) continue
    const bucket = byProp.get(prop)
    if (bucket) bucket.push({ value: val, lang })
    else byProp.set(prop, [{ value: val, lang }])
  }

  // Pick the first property in priority order that has a match,
  // preferring the requested language > 'en' > untagged > any.
  for (const propIri of DESCRIPTION_PROPERTIES) {
    const candidates = byProp.get(propIri)
    if (!candidates?.length) continue
    const best =
      candidates.find((c) => c.lang === language) ??
      candidates.find((c) => c.lang === 'en') ??
      candidates.find((c) => c.lang === '') ??
      candidates[0]
    if (best) return best.value
  }

  return ''
}
