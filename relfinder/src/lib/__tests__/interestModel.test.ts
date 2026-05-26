import { describe, it, expect, beforeEach } from 'vitest'
import type { InterestEntry } from '../search/types'
import { createInterestModel, computeAffinity } from '../search/interestModel'

// ── Helpers ───────────────────────────────────────────────────────────────────

const A = 'http://example.org/A'
const B = 'http://example.org/B'
const C = 'http://example.org/C'

let model: ReturnType<typeof createInterestModel>

beforeEach(() => {
  localStorage.clear()
  model = createInterestModel()
})

// ── Signal recording ──────────────────────────────────────────────────────────

describe('recordSelect', () => {
  it('increments selectCount', () => {
    model.recordSelect(A)
    model.recordSelect(A)
    expect(model.getEntry(A)?.selectCount).toBe(2)
  })

  it('creates an entry for a previously unseen IRI', () => {
    model.recordSelect(A)
    expect(model.getEntry(A)).toBeDefined()
  })

  it('clears the dismissed flag', () => {
    model.recordDismiss(A)
    expect(model.getEntry(A)?.dismissed).toBe(true)
    model.recordSelect(A)
    expect(model.getEntry(A)?.dismissed).toBe(false)
  })

  it('updates lastSeen', () => {
    const before = Date.now()
    model.recordSelect(A)
    expect(model.getEntry(A)!.lastSeen).toBeGreaterThanOrEqual(before)
  })
})

describe('recordView', () => {
  it('increments viewCount independently from selectCount', () => {
    model.recordView(A)
    model.recordView(A)
    expect(model.getEntry(A)?.viewCount).toBe(2)
    expect(model.getEntry(A)?.selectCount).toBe(0)
  })
})

describe('recordDwell', () => {
  it('accumulates dwell time across multiple calls', () => {
    model.recordDwell(A, 3_000)
    model.recordDwell(A, 7_000)
    expect(model.getEntry(A)?.dwellMs).toBe(10_000)
  })

  it('ignores zero or negative values', () => {
    model.recordDwell(A, 0)
    model.recordDwell(A, -500)
    expect(model.getEntry(A)).toBeUndefined()
  })
})

describe('recordPin', () => {
  it('sets the pinned flag', () => {
    model.recordPin(A)
    expect(model.getEntry(A)?.pinned).toBe(true)
  })

  it('clears the dismissed flag', () => {
    model.recordDismiss(A)
    model.recordPin(A)
    expect(model.getEntry(A)?.dismissed).toBe(false)
  })
})

describe('recordDismiss', () => {
  it('sets the dismissed flag', () => {
    model.recordDismiss(A)
    expect(model.getEntry(A)?.dismissed).toBe(true)
  })

  it('clears the pinned flag', () => {
    model.recordPin(A)
    model.recordDismiss(A)
    expect(model.getEntry(A)?.pinned).toBe(false)
  })
})

// ── Scoring ───────────────────────────────────────────────────────────────────

describe('getScore', () => {
  it('returns 0 for an unseen IRI', () => {
    expect(model.getScore('http://example.org/Unknown')).toBe(0)
  })

  it('returns a positive score after select', () => {
    model.recordSelect(A)
    expect(model.getScore(A)).toBeGreaterThan(0)
  })

  it('increases score with more selections (up to cap)', () => {
    for (let i = 0; i < 5; i++) model.recordSelect(A)
    const scoreAt5 = model.getScore(A)
    for (let i = 0; i < 5; i++) model.recordSelect(A)
    const scoreAt10 = model.getScore(A)
    expect(scoreAt10).toBeGreaterThan(scoreAt5)
  })

  it('is capped at 1', () => {
    for (let i = 0; i < 100; i++) {
      model.recordSelect(A)
      model.recordView(A)
    }
    expect(model.getScore(A)).toBeLessThanOrEqual(1)
  })

  it('pin increases score', () => {
    model.recordSelect(A)
    const withoutPin = model.getScore(A)
    model.recordPin(A)
    const withPin = model.getScore(A)
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
    model.recordSelect(A)
    for (let i = 0; i < 5; i++) model.recordSelect(B) // B has more selects → higher score
    model.recordSelect(C)

    const result = model.topK(3)
    expect(result[0]).toBe(B)
    expect(result.includes(A)).toBe(true)
    expect(result.includes(C)).toBe(true)
  })

  it('excludes dismissed entities', () => {
    model.recordSelect(A)
    model.recordSelect(B)
    model.recordDismiss(B)
    const result = model.topK(10)
    expect(result).not.toContain(B)
    expect(result).toContain(A)
  })

  it('returns at most k entries', () => {
    for (let i = 0; i < 10; i++) model.recordSelect(`http://example.org/E${i}`)
    expect(model.topK(3)).toHaveLength(3)
  })

  it('returns fewer than k when not enough entries exist', () => {
    model.recordSelect(A)
    expect(model.topK(10)).toHaveLength(1)
  })

  it('returns empty array when no entries exist', () => {
    expect(model.topK(5)).toHaveLength(0)
  })
})

// ── snapshot ──────────────────────────────────────────────────────────────────

describe('snapshot', () => {
  it('returns a copy — mutations do not affect live state', () => {
    model.recordSelect(A)
    const snap = model.snapshot()
    snap.delete(A)
    expect(model.getEntry(A)).toBeDefined()
  })

  it('contains all recorded IRIs', () => {
    model.recordSelect(A)
    model.recordView(B)
    const snap = model.snapshot()
    expect(snap.has(A)).toBe(true)
    expect(snap.has(B)).toBe(true)
  })
})

// ── clear ─────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('wipes all in-memory state', () => {
    model.recordSelect(A)
    model.clear()
    expect(model.getScore(A)).toBe(0)
    expect(model.topK(10)).toHaveLength(0)
  })

  it('removes the localStorage key', () => {
    model.recordSelect(A)
    expect(localStorage.getItem('rf:interest:v1')).not.toBeNull()
    model.clear()
    expect(localStorage.getItem('rf:interest:v1')).toBeNull()
  })
})

// ── Persistence ───────────────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('writes to localStorage on every signal update', () => {
    model.recordSelect(A)
    expect(localStorage.getItem('rf:interest:v1')).not.toBeNull()
  })

  it('restores state from localStorage when a new instance is created', () => {
    model.recordSelect(A)
    model.recordView(A)
    model.recordDwell(A, 5_000)
    // Simulate a fresh module load: create a new instance that reads from localStorage.
    const model2 = createInterestModel()
    expect(model2.getEntry(A)?.selectCount).toBe(1)
    expect(model2.getEntry(A)?.viewCount).toBe(1)
    expect(model2.getEntry(A)?.dwellMs).toBe(5_000)
    expect(model2.getScore(A)).toBeGreaterThan(0)
  })

  it('survives corrupted localStorage gracefully', () => {
    localStorage.setItem('rf:interest:v1', '{ INVALID JSON }}}')
    expect(() => createInterestModel()).not.toThrow()
    const model2 = createInterestModel()
    expect(model2.getScore(A)).toBe(0)
  })
})
