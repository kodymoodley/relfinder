/**
 * SparqlClient — the single point of endpoint-specific knowledge.
 *
 * Business-logic modules accept a SparqlClient instead of the raw
 * (QueryContext, Store | undefined) pair, so endpoint quirks never leak into callers.
 *
 * Endpoint capabilities are declared statically (via EndpointEntry.capabilities in
 * endpointDirectory.ts) and extended by conservative defaults so unknown endpoints
 * are always safe. The client applies query rewrites transparently before execution,
 * meaning callers express intent (e.g. ORDER BY) and the client decides whether to
 * honour it or strip it.
 */

import type { Store } from 'n3'
import type * as RDF from '@rdfjs/types'
import { runSelect, executeConstruct } from './engine'
import type { QueryContext, SparqlBinding } from './types'

// ── Capabilities ──────────────────────────────────────────────────────────────

export interface EndpointCapabilities {
  /**
   * Whether ORDER BY + OFFSET is supported without causing full-table-scan
   * timeouts. Conservative default: false.
   *
   * When false, ORDER BY is stripped from any query that also contains OFFSET.
   * Callers can still write ORDER BY freely — the rewrite is transparent.
   */
  supportsOrderByOffset: boolean

  /**
   * Whether CONSTRUCT queries are supported. Default: true.
   * Set to false for endpoints that reject or mis-handle CONSTRUCT.
   */
  supportsConstruct: boolean

  /**
   * Whether COUNT(*) queries are reliable (not slow or unsupported). Default: true.
   * Used by probeTripleCount — when false the probe returns Infinity immediately.
   */
  supportsCount: boolean
}

export const DEFAULT_CAPABILITIES: EndpointCapabilities = {
  supportsOrderByOffset: false,
  supportsConstruct: true,
  supportsCount: true,
}

// ── Client ────────────────────────────────────────────────────────────────────

export class SparqlClient {
  readonly isFileSource: boolean
  readonly caps: EndpointCapabilities

  private readonly _context: QueryContext
  private readonly _store: Store | undefined

  /**
   * @param context  QueryContext for remote SPARQL endpoints. Pass `{ endpointUrl: '' }`
   *                 for file sources (the store parameter takes precedence).
   * @param store    Populated N3 Store for file-upload mode. Omit for remote endpoints.
   * @param caps     Endpoint capability overrides. Merged with DEFAULT_CAPABILITIES.
   */
  /**
   * Stable key that uniquely identifies this source for use in caches.
   * 'file' for file sources; the endpoint URL for SPARQL sources.
   */
  readonly sourceKey: string

  constructor(context: QueryContext, store?: Store, caps: Partial<EndpointCapabilities> = {}) {
    this._context = context
    this._store = store
    this.isFileSource = store !== undefined
    this.sourceKey = store !== undefined ? 'file' : context.endpointUrl
    this.caps = { ...DEFAULT_CAPABILITIES, ...caps }
  }

  /**
   * Execute a SPARQL SELECT query, applying endpoint-specific rewrites transparently.
   * Dispatches to the local N3 store for file sources.
   */
  async select(query: string, signal?: AbortSignal): Promise<SparqlBinding[]> {
    return runSelect(this._rewrite(query), this._context, this._store, signal)
  }

  /**
   * Execute a SPARQL CONSTRUCT query against the remote endpoint.
   *
   * Returns an empty array when:
   *  - this is a file source (the store is already local — no remote call needed)
   *  - the endpoint does not support CONSTRUCT (`caps.supportsConstruct = false`)
   */
  async construct(query: string, signal?: AbortSignal): Promise<RDF.Quad[]> {
    if (this.isFileSource || !this.caps.supportsConstruct) return []
    return executeConstruct(query, this._context, signal)
  }

  // ── Query rewriting ─────────────────────────────────────────────────────────

  /**
   * Applies capability-aware rewrites to a SPARQL query before execution.
   *
   * Current rewrites:
   *  - Strip ORDER BY when OFFSET is also present and the endpoint does not
   *    support ordered pagination without full-table-scan timeouts.
   */
  private _rewrite(query: string): string {
    if (
      !this.caps.supportsOrderByOffset &&
      /\bORDER\s+BY\b/i.test(query) &&
      /\bOFFSET\b/i.test(query)
    ) {
      return query.replace(/\s*\bORDER\s+BY\b[^\n]*/gi, '')
    }
    return query
  }
}
