import type { InterestEntry } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'rf:interest:v1'

// ── Stateless helper (no instance state) ─────────────────────────────────────

/**
 * Computes a normalised [0, 1] affinity score from an interest entry.
 * Weights are intentional tuning knobs — adjust as A/B data accumulates.
 * Dismissed entities are not penalised here; callers filter them at the use-site.
 */
export function computeAffinity(entry: InterestEntry): number {
  return Math.max(
    0,
    0.4 * Math.min(entry.selectCount / 10, 1) +
      0.3 * Math.min(entry.viewCount / 20, 1) +
      0.2 * Math.min(entry.dwellMs / 60_000, 1) +
      0.1 * (entry.pinned ? 1 : 0),
  )
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates an isolated interest-model instance. Each call returns a fresh
 * instance with its own in-memory map that hydrates from localStorage on
 * construction. Production code uses the module-level singleton; tests call
 * this directly to get a clean slate without needing `_resetForTest`.
 */
export function createInterestModel() {
  const _interest = new Map<string, InterestEntry>()

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([..._interest.entries()]))
    } catch {
      // QuotaExceededError or SSR context — in-memory state is still correct.
    }
  }

  function load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Array<[string, InterestEntry]>
      for (const [iri, entry] of parsed) {
        _interest.set(iri, entry)
      }
    } catch {
      // Corrupted storage — start fresh.
    }
  }

  // Hydrate from localStorage on creation.
  load()

  function getOrCreate(iri: string): InterestEntry {
    let entry = _interest.get(iri)
    if (entry === undefined) {
      entry = {
        iri,
        selectCount: 0,
        viewCount: 0,
        dwellMs: 0,
        pinned: false,
        dismissed: false,
        lastSeen: Date.now(),
      }
      _interest.set(iri, entry)
    }
    return entry
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Records that the user selected this entity as E1 or E2. */
  function recordSelect(iri: string): void {
    const entry = getOrCreate(iri)
    entry.selectCount++
    entry.dismissed = false // an explicit selection overrides a prior dismiss
    entry.lastSeen = Date.now()
    persist()
  }

  /** Records that the user opened the detail panel for this entity. */
  function recordView(iri: string): void {
    const entry = getOrCreate(iri)
    entry.viewCount++
    entry.lastSeen = Date.now()
    persist()
  }

  /**
   * Accumulates dwell time spent in the detail panel for this entity.
   * Non-positive values are ignored.
   */
  function recordDwell(iri: string, ms: number): void {
    if (ms <= 0) return
    const entry = getOrCreate(iri)
    entry.dwellMs += ms
    entry.lastSeen = Date.now()
    persist()
  }

  /** Records an explicit pin — keep this entity prominent in results. */
  function recordPin(iri: string): void {
    const entry = getOrCreate(iri)
    entry.pinned = true
    entry.dismissed = false
    entry.lastSeen = Date.now()
    persist()
  }

  /** Records an explicit dismiss — suppress this entity in results. */
  function recordDismiss(iri: string): void {
    const entry = getOrCreate(iri)
    entry.dismissed = true
    entry.pinned = false
    entry.lastSeen = Date.now()
    persist()
  }

  /** Returns the normalised [0, 1] affinity score for the given IRI, or 0 if unseen. */
  function getScore(iri: string): number {
    const entry = _interest.get(iri)
    return entry === undefined ? 0 : computeAffinity(entry)
  }

  /** Returns the raw interest entry for the given IRI, or undefined if unseen. */
  function getEntry(iri: string): InterestEntry | undefined {
    return _interest.get(iri)
  }

  /**
   * Returns up to k IRIs ordered by affinity score (highest first),
   * excluding dismissed entities. Used by the prefetch worker to decide
   * which neighbourhoods to fetch next.
   */
  function topK(k: number): string[] {
    return [..._interest.entries()]
      .filter(([, e]) => !e.dismissed)
      .sort(([, a], [, b]) => computeAffinity(b) - computeAffinity(a))
      .slice(0, k)
      .map(([iri]) => iri)
  }

  /**
   * Returns a shallow copy of the full interest map.
   * Passed to ranking fusion and eviction policies so they operate on a
   * stable snapshot rather than live state.
   */
  function snapshot(): Map<string, InterestEntry> {
    return new Map(_interest)
  }

  /** Wipes all interest state from memory and localStorage. */
  function clear(): void {
    _interest.clear()
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  return {
    recordSelect,
    recordView,
    recordDwell,
    recordPin,
    recordDismiss,
    getScore,
    getEntry,
    topK,
    snapshot,
    clear,
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// Production call sites import these named exports directly — no changes needed
// at any call site. Tests use createInterestModel() to get a fresh instance.

const _singleton = createInterestModel()

export const recordSelect = _singleton.recordSelect
export const recordView = _singleton.recordView
export const recordDwell = _singleton.recordDwell
export const recordPin = _singleton.recordPin
export const recordDismiss = _singleton.recordDismiss
export const getScore = _singleton.getScore
export const getEntry = _singleton.getEntry
export const topK = _singleton.topK
export const snapshot = _singleton.snapshot
export const clear = _singleton.clear
