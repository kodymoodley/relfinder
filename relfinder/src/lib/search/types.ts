// ── Cached entity ─────────────────────────────────────────────────────────────

/** Canonical shape of a browser-side cached entity. */
export interface CachedEntity {
  iri: string
  label: string
  altLabels: string[] // skos:altLabel, foaf:name, schema:name, dc:title, etc.
  classIri: string // rdf:type IRI
  classLabel: string // local name of classIri — used for search indexing and display
  description: string // rdfs:comment / dcterms:description; empty string when unknown
  addedAt: number // Date.now() at first insertion — drives TTL policies
  lastAccessed: number // Date.now() on each read — drives LRU policies
}

// ── Interest model ────────────────────────────────────────────────────────────

/** Per-entity behavioural signals accumulated during a session. */
export interface InterestEntry {
  iri: string
  selectCount: number // times chosen as E1 or E2
  viewCount: number // times the detail panel was opened
  dwellMs: number // cumulative milliseconds spent in the detail panel
  pinned: boolean // explicit keep signal from the user
  dismissed: boolean // explicit hide signal from the user
  lastSeen: number // Date.now() of the most recent signal update
}

// ── Search result ─────────────────────────────────────────────────────────────

/** A CachedEntity decorated with scoring breakdown after ranking fusion. */
export interface ScoredEntity extends CachedEntity {
  bm25Score: number
  semanticScore: number // always 0 in Phase 1; populated by embedding worker in Phase 2
  affinityScore: number
  finalScore: number
  source: 'index' | 'sparql-fallback' | 'semantic'
}

// ── Pluggable strategy interfaces ─────────────────────────────────────────────

/**
 * Eviction policies select which cached entities to remove when the cache
 * exceeds its size limit. Swap via setEvictionPolicy() with no other changes.
 */
export interface EvictionPolicy {
  readonly name: string
  /**
   * Returns the IRIs of entries to evict so the cache fits within targetSize.
   * Only called when entries.length > targetSize.
   */
  selectVictims(
    entries: CachedEntity[],
    interest: Map<string, InterestEntry>,
    targetSize: number,
  ): string[]
}

/**
 * Ranking fusion strategies combine BM25, semantic, and affinity scores into
 * a single ordered result list. Swap via strategyRegistry with no other changes.
 */
export interface RankingFusion {
  readonly name: string
  fuse(
    bm25Results: ScoredEntity[],
    semanticResults: ScoredEntity[],
    interest: Map<string, InterestEntry>,
  ): ScoredEntity[]
}

// ── Worker message protocol ───────────────────────────────────────────────────

/** Messages sent from the main thread to the search index worker. */
export type SearchWorkerIn =
  | { type: 'SEARCH'; id: number; query: string; limit: number; classIris?: string[] }
  | { type: 'ADD'; entities: CachedEntity[] }
  | { type: 'REMOVE'; iris: string[] }
  | { type: 'CLEAR' }

/** Messages sent from the search index worker back to the main thread. */
export type SearchWorkerOut =
  | { type: 'READY' }
  | { type: 'RESULTS'; id: number; results: ScoredEntity[] }
