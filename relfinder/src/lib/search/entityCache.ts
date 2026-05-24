import { openDB, type IDBPDatabase } from 'idb'
import type { CachedEntity, EvictionPolicy, InterestEntry } from './types'
import { lruPolicy } from './eviction/lru'

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME = 'rf-entity-cache'
const DB_VERSION = 1
const STORE = 'entities'

/** Maximum entities held in memory. Eviction fires when this is exceeded. */
export const CACHE_MAX = 5_000

// ── Module state ──────────────────────────────────────────────────────────────

let _db: IDBPDatabase | null = null
let _initPromise: Promise<void> | null = null
const _entities = new Map<string, CachedEntity>()
let _policy: EvictionPolicy = lruPolicy

const _dirty = new Set<string>()    // entities modified since the last IDB flush
const _deleted = new Set<string>()  // entities removed since the last IDB flush
let _flushScheduled = false

// ── Observability hooks ───────────────────────────────────────────────────────
// External modules (metrics, workers, etc.) may wire in here without touching
// cache internals. Properties on this object are mutable even though the
// binding itself is not: `import { hooks } from './entityCache'; hooks.onAdd = fn`

export const hooks: {
  onAdd: ((entities: CachedEntity[]) => void) | null
  onEvict: ((iris: string[]) => void) | null
} = {
  onAdd: null,
  onEvict: null,
}

// ── IDB initialisation ────────────────────────────────────────────────────────

async function openCache(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'iri' })
      }
    },
  })
}

/**
 * Opens IndexedDB and hydrates the in-memory map from persisted data.
 * Safe to call multiple times — returns the same Promise on repeated calls.
 * Degrades gracefully to in-memory-only when IDB is unavailable (private
 * browsing, storage quota exceeded, etc.).
 */
export function initEntityCache(): Promise<void> {
  if (_initPromise !== null) return _initPromise
  _initPromise = (async () => {
    try {
      _db = await openCache()
      const stored = (await _db.getAll(STORE)) as CachedEntity[]
      for (const entity of stored) {
        _entities.set(entity.iri, entity)
      }
    } catch {
      _db = null
    }
  })()
  return _initPromise
}

// ── Idle-time IDB flush ───────────────────────────────────────────────────────

const _idle: (fn: () => void) => void =
  typeof requestIdleCallback !== 'undefined'
    ? (fn) => requestIdleCallback(fn, { timeout: 2_000 })
    : (fn) => setTimeout(fn, 0)

async function doFlush(): Promise<void> {
  if (_db === null || (_dirty.size === 0 && _deleted.size === 0)) return
  const toWrite = [..._dirty]
    .filter((iri) => _entities.has(iri))
    .map((iri) => _entities.get(iri)!)
  const toDelete = [..._deleted]
  _dirty.clear()
  _deleted.clear()
  try {
    const tx = _db.transaction(STORE, 'readwrite')
    await Promise.all([
      ...toWrite.map((e) => tx.store.put(e)),
      ...toDelete.map((iri) => tx.store.delete(iri)),
    ])
    await tx.done
  } catch {
    // Best-effort persistence. In-memory state is always authoritative.
  }
}

function scheduleFlush(): void {
  if (_flushScheduled) return
  _flushScheduled = true
  _idle(() => {
    _flushScheduled = false
    doFlush().catch(() => {})
  })
}

// ── Eviction ──────────────────────────────────────────────────────────────────

function evictIfNeeded(interest: Map<string, InterestEntry>): void {
  if (_entities.size <= CACHE_MAX) return
  const victims = _policy.selectVictims([..._entities.values()], interest, CACHE_MAX)
  for (const iri of victims) {
    _entities.delete(iri)
    _dirty.delete(iri)
    _deleted.add(iri)
  }
  if (victims.length > 0) hooks.onEvict?.(victims)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Replaces the active eviction policy. Takes effect on the next eviction. */
export function setEvictionPolicy(policy: EvictionPolicy): void {
  _policy = policy
}

/**
 * Adds or updates entities in the cache. Existing entries retain their original
 * addedAt timestamp. Triggers eviction if CACHE_MAX is exceeded.
 *
 * @param interest - Current interest snapshot used for relevance-scored eviction.
 *   Defaults to an empty map (falls back to LRU ordering within the policy).
 */
export function cacheAdd(
  entities: CachedEntity[],
  interest: Map<string, InterestEntry> = new Map(),
): void {
  if (entities.length === 0) return
  const now = Date.now()
  const added: CachedEntity[] = []
  for (const entity of entities) {
    const existing = _entities.get(entity.iri)
    const record: CachedEntity = {
      ...entity,
      // Preserve timestamps from the first insertion; use entity's own value
      // as the fallback so callers can supply a specific addedAt on cold-seed.
      addedAt: existing?.addedAt ?? entity.addedAt,
      lastAccessed: existing?.lastAccessed ?? entity.lastAccessed,
    }
    _entities.set(entity.iri, record)
    _dirty.add(entity.iri)
    added.push(record)
  }
  hooks.onAdd?.(added)
  evictIfNeeded(interest)
  scheduleFlush()
}

/**
 * Retrieves an entity by IRI, refreshing its lastAccessed timestamp.
 * Returns undefined when the IRI is not in cache.
 */
export function cacheGet(iri: string): CachedEntity | undefined {
  const entity = _entities.get(iri)
  if (entity !== undefined) {
    entity.lastAccessed = Date.now()
    _dirty.add(iri)
    scheduleFlush()
  }
  return entity
}

/** Removes specific entities from cache and schedules their IDB deletion. */
export function cacheRemove(iris: string[]): void {
  let removed = false
  for (const iri of iris) {
    if (_entities.delete(iri)) {
      _dirty.delete(iri)
      _deleted.add(iri)
      removed = true
    }
  }
  if (removed) scheduleFlush()
}

/** Returns a snapshot array of all entities currently in memory. */
export function cacheAll(): CachedEntity[] {
  return [..._entities.values()]
}

/** Returns the number of entities currently in memory. */
export function cacheSize(): number {
  return _entities.size
}

/** Returns true when the IRI is present in the in-memory cache. */
export function cacheHas(iri: string): boolean {
  return _entities.has(iri)
}

/** Wipes all in-memory and IDB state. Call on disconnect. */
export function cacheClear(): void {
  _entities.clear()
  _dirty.clear()
  _deleted.clear()
  _flushScheduled = false
  _db?.clear(STORE).catch(() => {})
}

// ── Test support ──────────────────────────────────────────────────────────────

/** Resets all module-level state. For unit tests only — not part of the public API. */
export function _resetForTest(): void {
  _entities.clear()
  _dirty.clear()
  _deleted.clear()
  _flushScheduled = false
  _db = null
  _initPromise = null
  _policy = lruPolicy
  hooks.onAdd = null
  hooks.onEvict = null
}
