// @vitest-environment node

/**
 * Unit tests for queryCache — the session-scoped SPARQL result cache.
 *
 * Uses fake timers to control TTL expiry without real waits.
 * Calls cacheInvalidate() in beforeEach because the cache is a module-level
 * singleton that persists across tests in the same worker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheSet, cacheInvalidate, cacheSize } from '@/lib/cache/queryCache'

beforeEach(() => {
  cacheInvalidate()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── cacheGet ──────────────────────────────────────────────────────────────────

describe('cacheGet', () => {
  it('returns undefined for a missing key', () => {
    expect(cacheGet('missing')).toBeUndefined()
  })

  it('returns the stored value on a cache hit', () => {
    cacheSet('key', { data: 42 })
    expect(cacheGet<{ data: number }>('key')).toEqual({ data: 42 })
  })

  it('returns undefined for an expired entry', () => {
    cacheSet('key', 'value', 1_000)
    vi.advanceTimersByTime(1_001)
    expect(cacheGet('key')).toBeUndefined()
  })

  it('evicts the expired entry so cacheSize drops', () => {
    cacheSet('key', 'value', 1_000)
    vi.advanceTimersByTime(1_001)
    cacheGet('key')
    expect(cacheSize()).toBe(0)
  })

  it('returns the value 1 ms before expiry', () => {
    cacheSet('key', 'value', 1_000)
    vi.advanceTimersByTime(999)
    expect(cacheGet('key')).toBe('value')
  })

  it('preserves the exact type of the stored value', () => {
    const arr = [1, 2, 3]
    cacheSet('arr', arr)
    expect(cacheGet<number[]>('arr')).toEqual(arr)
  })
})

// ── cacheSet ──────────────────────────────────────────────────────────────────

describe('cacheSet', () => {
  it('stores a value that is immediately retrievable', () => {
    cacheSet('k', 'hello')
    expect(cacheGet('k')).toBe('hello')
  })

  it('respects a custom TTL', () => {
    cacheSet('k', 'v', 500)
    vi.advanceTimersByTime(499)
    expect(cacheGet('k')).toBe('v')
    vi.advanceTimersByTime(2)
    expect(cacheGet('k')).toBeUndefined()
  })

  it('overwrites an existing entry with the same key', () => {
    cacheSet('k', 'first', 5_000)
    cacheSet('k', 'second', 5_000)
    expect(cacheGet('k')).toBe('second')
    expect(cacheSize()).toBe(1)
  })

  it('stores distinct keys independently', () => {
    cacheSet('a', 1)
    cacheSet('b', 2)
    expect(cacheGet('a')).toBe(1)
    expect(cacheGet('b')).toBe(2)
  })
})

// ── cacheSize ─────────────────────────────────────────────────────────────────

describe('cacheSize', () => {
  it('returns 0 for an empty cache', () => {
    expect(cacheSize()).toBe(0)
  })

  it('increments as entries are added', () => {
    cacheSet('a', 1)
    expect(cacheSize()).toBe(1)
    cacheSet('b', 2)
    expect(cacheSize()).toBe(2)
  })

  it('does not decrement lazily — expired entries are counted until accessed', () => {
    cacheSet('a', 1, 1_000)
    vi.advanceTimersByTime(1_001)
    expect(cacheSize()).toBe(1) // expired but not yet evicted
    cacheGet('a')               // triggers eviction
    expect(cacheSize()).toBe(0)
  })
})

// ── cacheInvalidate ───────────────────────────────────────────────────────────

describe('cacheInvalidate', () => {
  it('clears all entries', () => {
    cacheSet('a', 1)
    cacheSet('b', 2)
    cacheInvalidate()
    expect(cacheSize()).toBe(0)
    expect(cacheGet('a')).toBeUndefined()
    expect(cacheGet('b')).toBeUndefined()
  })

  it('is safe to call on an already-empty cache', () => {
    expect(() => cacheInvalidate()).not.toThrow()
  })

  it('does not affect entries added after the call', () => {
    cacheSet('before', 'x')
    cacheInvalidate()
    cacheSet('after', 'y')
    expect(cacheGet('after')).toBe('y')
    expect(cacheSize()).toBe(1)
  })
})
