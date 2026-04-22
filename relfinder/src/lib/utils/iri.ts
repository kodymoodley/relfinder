/**
 * Shared IRI utility helpers used across the lib layer and UI components.
 */

/**
 * Returns the local name of an IRI — the fragment identifier or last path
 * segment, whichever is non-empty. Falls back to the full IRI string when
 * neither can be extracted.
 *
 * Examples:
 *   'http://www.w3.org/2002/07/owl#Class'   → 'Class'
 *   'http://dbpedia.org/ontology/Actor'      → 'Actor'
 *   'http://example.org/'                    → 'http://example.org/'
 */
export function shortIri(iri: string): string {
  return iri.split('/').pop()?.split('#').pop() ?? iri
}
