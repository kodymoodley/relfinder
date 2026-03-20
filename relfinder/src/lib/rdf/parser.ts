/**
 * RDF file parsing utilities.
 *
 * Wraps N3.js to parse locally uploaded RDF files (Turtle, N-Triples,
 * N-Quads, TriG, JSON-LD) into an in-memory N3.js `Store`. The store can
 * then be passed directly to Comunica's `executeSelectOnStore()` so the same
 * SPARQL query logic works over local files without any server.
 *
 * JSON-LD is not supported natively by N3.js — for that format the user
 * should convert to Turtle first, or a JSON-LD-to-N3 pre-processing step
 * can be added here in a later stage.
 */

import { Parser, Store, DataFactory } from 'n3'
import type { Quad } from 'n3'

// ── Format detection ──────────────────────────────────────────────────────────

/** MIME types accepted for local RDF file uploads. */
export const SUPPORTED_MIME_TYPES = [
  'text/turtle',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
] as const

export type RdfMimeType = (typeof SUPPORTED_MIME_TYPES)[number]

/**
 * Infers the RDF serialisation format from a filename extension.
 * Returns `null` when the extension is unrecognised.
 */
export function detectFormat(filename: string): RdfMimeType | null {
  const ext = filename.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'ttl':
      return 'text/turtle'
    case 'nt':
      return 'application/n-triples'
    case 'nq':
      return 'application/n-quads'
    case 'trig':
      return 'application/trig'
    case 'n3':
      // N3 notation — N3.js handles it under the Turtle parser
      return 'text/turtle'
    default:
      return null
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parses a string of RDF content into an N3.js `Store`.
 *
 * @param content   Raw text content of the uploaded file.
 * @param format    MIME type of the serialisation (use `detectFormat` if unknown).
 * @param baseIri   Optional base IRI used to resolve relative IRIs in the file.
 *
 * @throws `Error` if the content cannot be parsed (syntax error, unsupported
 *   format, etc.).
 */
export function parseRdfContent(
  content: string,
  format: RdfMimeType,
  baseIri = 'http://example.org/',
): Promise<Store> {
  return new Promise((resolve, reject) => {
    const store = new Store()
    const parser = new Parser({ format, baseIRI: baseIri, factory: DataFactory })

    parser.parse(content, (error: Error | null, quad: Quad | null) => {
      if (error) {
        reject(new Error(`RDF parse error: ${error.message}`))
        return
      }

      if (quad) {
        store.addQuad(quad)
      } else {
        // `quad` is null when parsing is complete
        resolve(store)
      }
    })
  })
}

// ── File → Store pipeline ─────────────────────────────────────────────────────

/**
 * Reads a browser `File` object and returns a populated N3.js `Store`.
 *
 * This is the main entry point for the file-upload workflow in the UI.
 * It combines `FileReader`, format detection, and `parseRdfContent` into
 * one awaitable call.
 *
 * @throws `Error` if the file extension is not recognised or parsing fails.
 */
export async function fileToStore(file: File): Promise<Store> {
  const format = detectFormat(file.name)

  if (!format) {
    throw new Error(
      `Unsupported file extension: "${file.name.split('.').pop()}". ` +
        `Supported formats: .ttl, .nt, .nq, .trig, .n3`,
    )
  }

  const content = await file.text()
  return parseRdfContent(content, format, `file:///${file.name}`)
}

// ── Store introspection ───────────────────────────────────────────────────────

/**
 * Returns the number of triples in a store — useful for showing a quick
 * summary in the connection screen after a file is loaded.
 */
export function storeSize(store: Store): number {
  return store.size
}
