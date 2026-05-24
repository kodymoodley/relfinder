import MiniSearch from 'minisearch'
import type { CachedEntity, SearchWorkerIn, SearchWorkerOut, ScoredEntity } from '../lib/search/types'

// ── Index setup ───────────────────────────────────────────────────────────────

const index = new MiniSearch<CachedEntity>({
  idField: 'iri',
  fields: ['label', 'altLabels', 'classLabel', 'description'],
  storeFields: [
    'iri',
    'label',
    'altLabels',
    'classIri',
    'classLabel',
    'description',
    'addedAt',
    'lastAccessed',
  ],
  extractField(document, fieldName) {
    // Join array fields so MiniSearch can tokenise them as a single string.
    // storeFields retain the original array value for retrieval.
    if (fieldName === 'altLabels') {
      return document.altLabels.join(' ')
    }
    return (document as unknown as Record<string, unknown>)[fieldName] as string
  },
  searchOptions: {
    boost: { label: 3, altLabels: 2, classLabel: 1 },
    fuzzy: 0.2,
    prefix: true,
  },
})

// Tracks indexed IRIs to distinguish add vs replace operations.
const _indexed = new Set<string>()

// ── Stored-field shape returned by MiniSearch search results ──────────────────

interface StoredResult {
  id: string
  score: number
  iri: string
  label: string
  altLabels: string[]
  classIri: string
  classLabel: string
  description: string
  addedAt: number
  lastAccessed: number
}

// ── Index management ──────────────────────────────────────────────────────────

function addEntities(entities: CachedEntity[]): void {
  for (const entity of entities) {
    if (_indexed.has(entity.iri)) {
      index.replace(entity)
    } else {
      index.add(entity)
      _indexed.add(entity.iri)
    }
  }
}

function removeEntities(iris: string[]): void {
  for (const iri of iris) {
    if (_indexed.has(iri)) {
      index.discard(iri)
      _indexed.delete(iri)
    }
  }
}

// ── Result conversion ─────────────────────────────────────────────────────────

function toScoredEntities(raw: StoredResult[], limit: number): ScoredEntity[] {
  const maxScore = raw.reduce((m, r) => (r.score > m ? r.score : m), 0)
  return raw.slice(0, limit).map((r) => ({
    iri: r.iri,
    label: r.label,
    altLabels: r.altLabels,
    classIri: r.classIri,
    classLabel: r.classLabel,
    description: r.description,
    addedAt: r.addedAt,
    lastAccessed: r.lastAccessed,
    bm25Score: maxScore > 0 ? r.score / maxScore : 0,
    semanticScore: 0,
    affinityScore: 0,
    finalScore: 0,
    source: 'index' as const,
  }))
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<SearchWorkerIn>) => {
  const msg = e.data

  if (msg.type === 'ADD') {
    addEntities(msg.entities)
    return
  }

  if (msg.type === 'REMOVE') {
    removeEntities(msg.iris)
    return
  }

  if (msg.type === 'CLEAR') {
    index.removeAll()
    _indexed.clear()
    return
  }

  if (msg.type === 'SEARCH') {
    const { id, query, limit, classIris } = msg
    const raw = index.search(query, {
      filter:
        classIris && classIris.length > 0
          ? (r) => classIris.includes((r as unknown as StoredResult).classIri)
          : undefined,
    }) as unknown as StoredResult[]

    const results = toScoredEntities(raw, limit)
    self.postMessage({ type: 'RESULTS', id, results } satisfies SearchWorkerOut)
  }
}

// Signal readiness to the main thread.
self.postMessage({ type: 'READY' } satisfies SearchWorkerOut)
