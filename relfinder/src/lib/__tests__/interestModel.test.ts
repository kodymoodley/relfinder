import { describe, it, expect, beforeEach } from 'vitest'
import type { InterestEntry } from '../search/types'
import {
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
  computeAffinity,
  _resetForTest,
  _loadForTest,
} from '../search/interestModel'

// ── Helpers ───────────────────────────────────────────────────────────────────

const A = 'http://example.org/A'
const B = 'http://example.org/B'
const C = 'http://example.org/C'

beforeEach(() => {
  localStorage.clear()
  _resetForTest()
})

// ── Signal recording ──────────────────────────────────────────────────────────

describe('recordSelect', () => {
  it('increments selectCount', () => {
    recordSelect(A)
    recordSelect(A)
    expect(getEntry(A)?.selectCount).toBe(2)
  })

  it('creates an entry for a previously unseen IRI', () => {
    recordSelect(A)
    expect(getEntry(A)).toBeDefined()
  })

  it('clears the dismissed flag', () => {
    recordDismiss(A)
    expect(getEntry(A)?.dismissed).toBe(true)
    recordSelect(A)
    expect(getEntry(A)?.dismissed).toBe(false)
  })

  it('updates lastSeen', () => {
    const before = Date.now()
    recordSelect(A)
    expect(getEntry(A)!.lastSeen).toBeGreaterThanOrEqual(before)
  })
})

describe('recordView', () => {
  it('increments viewCount independently from selectCount', () => {
    recordView(A)
    recordView(A)
    expect(getEntry(A)?.viewCount).toBe(2)
    expect(getEntry(A)?.selectCount).toBe(0)
  })
})

describe('recordDwell', () => {
  it('accumulates dwell time across multiple calls', () => {
    recordDwell(A, 3_000)
    recordDwell(A, 7_000)
    expect(getEntry(A)?.dwellMs).toBe(10_000)
  })

  it('ignores zero or negative values', () => {
    recordDwell(A, 0)
    recordDwell(A, -500)
    expect(getEntry(A)).toBeUndefined()
  })
})

describe('recordPin', () => {
  it('sets the pinned flag', () => {
    recordPin(A)
    expect(getEntry(A)?.pinned).toBe(true)
  })

  it('clears the dismissed flag', () => {
    recordDismiss(A)
    recordPin(A)
    expect(getEntry(A)?.dismissed).toBe(false)
  })
})

describe('recordDismiss', () => {
  it('sets the dismissed flag', () => {
    recordDismiss(A)
    expect(getEntry(A)?.dismissed).toBe(true)
  })

  it('clears the pinned flag', () => {
    recordPin(A)
    recordDismiss(A)
    expect(getEntry(A)?.pinned).toBe(false)
  })
})

// ── Scoring ───────────────────────────────────────────────────────────────────

describe('getScore', () => {
  it('returns 0 for an unseen IRI', () => {
    expect(getScore('http://example.org/Unknown')).toBe(0)
  })

  it('returns a positive score after select', () => {
    recordSelect(A)
    expect(getScore(A)).toBeGreaterThan(0)
  })

  it('increases score with more selections (up to cap)', () => {
    for (let i = 0; i < 5; i++) recordSelect(A)
    const scoreAt5 = getScore(A)
    for (let i = 0; i < 5; i++) recordSelect(A)
    const scoreAt10 = getScore(A)
    expect(scoreAt10).toBeGreaterThan(scoreAt5)
  })

  it('is capped at 1', () => {
    for (let i = 0; i < 100; i++) {
      recordSelect(A)
      recordView(A)
    }
    expect(getScore(A)).toBeLessThanOrEqual(1)
  })

  it('pin increases score', () => {
    recordSelect(A)
    const withoutPin = getScore(A)
    recordPin(A)
    const withPin = getScore(A)
    expect(withPin).toBeGreaterThan(withoutPin)
  })
})

describe('computeAffinity', () => {
  it('returns 0 for a zeroed entry', () => {
    const entry: InterestEntry = {
      iri: A,
      selectCount: 0,
      viewCount: 0,
      dwellMs: 0,
      pinned: false,
      dismissed: false,
      lastSeen: Date.now(),
    }
    expect(computeAffinity(entry)).toBe(0)
  })

  it('returns 1 for a fully saturated entry', () => {
    const entry: InterestEntry = {
      iri: A,
      selectCount: 10,
      viewCount: 20,
      dwellMs: 60_000,
      pinned: true,
      dismissed: false,
      lastSeen: Date.now(),
    }
    expect(computeAffinity(entry)).toBeCloseTo(1, 10)
  })
})

// ── topK ─────────────────────────────────────────────────────────────────────

describe('topK', () => {
  it('returns entities ordered by affinity score, highest first', () => {
    recordSelect(A)
    for (let i = 0; i < 5; i++) recordSelect(B) // B has more selects → higher score
    recordSelect(C)

    const result = topK(3)
    expect(result[0]).toBe(B)
    expect(result.includes(A)).toBe(true)
    expect(result.includes(C)).toBe(true)
  })

  it('excludes dismissed entities', () => {
    recordSelect(A)
    recordSelect(B)
    recordDismiss(B)
    const result = topK(10)
    expect(result).not.toContain(B)
    expect(result).toContain(A)
  })

  it('returns at most k entries', () => {
    for (let i = 0; i < 10; i++) recordSelect(`http://example.org/E${i}`)
    expect(topK(3)).toHaveLength(3)
  })

  it('returns fewer than k when not enough entries exist', () => {
    recordSelect(A)
    expect(topK(10)).toHaveLength(1)
  })

  it('returns empty array when no entries exist', () => {
    expect(topK(5)).toHaveLength(0)
  })
})

// ── snapshot ──────────────────────────────────────────────────────────────────

describe('snapshot', () => {
  it('returns a copy — mutations do not affect live state', () => {
    recordSelect(A)
    const snap = snapshot()
    snap.delete(A)
    expect(getEntry(A)).toBeDefined()
  })

  it('contains all recorded IRIs', () => {
    recordSelect(A)
    recordView(B)
    const snap = snapshot()
    expect(snap.has(A)).toBe(true)
    expect(snap.has(B)).toBe(true)
  })
})

// ── clear ─────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('wipes all in-memory state', () => {
    recordSelect(A)
    clear()
    expect(getScore(A)).toBe(0)
    expect(topK(10)).toHaveLength(0)
  })

  it('removes the localStorage key', () => {
    recordSelect(A)
    expect(localStorage.getItem('rf:interest:v1')).not.toBeNull()
    clear()
    expect(localStorage.getItem('rf:interest:v1')).toBeNull()
  })
})

// ── Persistence ───────────────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('writes to localStorage on every signal update', () => {
    recordSelect(A)
    expect(localStorage.getItem('rf:interest:v1')).not.toBeNull()
  })

  it('restores state from localStorage on _loadForTest()', () => {
    recordSelect(A)
    recordView(A)
    recordDwell(A, 5_000)
    // Simulate a fresh module load: wipe memory, restore from storage.
    _resetForTest()
    expect(getScore(A)).toBe(0)
    _loadForTest()
    expect(getEntry(A)?.selectCount).toBe(1)
    expect(getEntry(A)?.viewCount).toBe(1)
    expect(getEntry(A)?.dwellMs).toBe(5_000)
    expect(getScore(A)).toBeGreaterThan(0)
  })

  it('survives corrupted localStorage gracefully', () => {
    localStorage.setItem('rf:interest:v1', '{ INVALID JSON }}}')
    expect(() => _loadForTest()).not.toThrow()
    expect(getScore(A)).toBe(0)
  })
})
