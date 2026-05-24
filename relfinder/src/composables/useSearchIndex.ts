import type { CachedEntity, SearchWorkerIn, SearchWorkerOut, ScoredEntity } from '@/lib/search/types'

// ── Module-level singleton ────────────────────────────────────────────────────
// One Worker is shared for the entire app lifetime. The composable returns
// functions that delegate to it; creating multiple instances is safe.

let _worker: Worker | null = null
let _nextId = 0
const _pending = new Map<number, (results: ScoredEntity[]) => void>()

function handleMessage(e: MessageEvent<SearchWorkerOut>): void {
  const msg = e.data
  if (msg.type !== 'RESULTS') return
  const resolve = _pending.get(msg.id)
  if (resolve !== undefined) {
    resolve(msg.results)
    _pending.delete(msg.id)
  }
}

function ensureWorker(): Worker {
  if (_worker !== null) return _worker
  _worker = new Worker(
    new URL('../workers/searchIndex.worker.ts', import.meta.url),
    { type: 'module' },
  )
  _worker.onmessage = handleMessage
  return _worker
}

// ── Exposed functions ─────────────────────────────────────────────────────────

/**
 * Searches the local MiniSearch index.
 * Returns an empty array immediately for blank queries.
 * Resolves with raw ScoredEntity results (bm25Score populated, others zeroed);
 * callers apply ranking fusion before rendering.
 */
function search(
  query: string,
  limit: number,
  classIris?: string[],
): Promise<ScoredEntity[]> {
  const trimmed = query.trim()
  if (!trimmed) return Promise.resolve([])
  return new Promise((resolve) => {
    const id = _nextId++
    _pending.set(id, resolve)
    ensureWorker().postMessage({
      type: 'SEARCH',
      id,
      query: trimmed,
      limit,
      classIris,
    } satisfies SearchWorkerIn)
  })
}

/** Adds or updates entities in the search index (fire-and-forget). */
function add(entities: CachedEntity[]): void {
  if (entities.length === 0) return
  ensureWorker().postMessage({ type: 'ADD', entities } satisfies SearchWorkerIn)
}

/** Removes entities from the search index by IRI (fire-and-forget). */
function remove(iris: string[]): void {
  if (iris.length === 0) return
  ensureWorker().postMessage({ type: 'REMOVE', iris } satisfies SearchWorkerIn)
}

/** Clears the entire search index (fire-and-forget). */
function clear(): void {
  ensureWorker().postMessage({ type: 'CLEAR' } satisfies SearchWorkerIn)
}

// ── Public composable ─────────────────────────────────────────────────────────

export function useSearchIndex() {
  return { search, add, remove, clear }
}

// ── Test support ──────────────────────────────────────────────────────────────

/** Terminates the Worker and resets all state. For unit tests only. */
export function _resetWorkerForTest(): void {
  _worker?.terminate()
  _worker = null
  _nextId = 0
  _pending.clear()
}
