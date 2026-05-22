// @vitest-environment node

/**
 * Unit tests for queryCache.
 *
 * Focuses on the two guarantees the app actually relies on:
 *   1. Cache hits avoid repeated SPARQL fetches within a session.
 *   2. cacheInvalidate() on disconnect prevents stale data from one endpoint
 *      being served to a different one.
 *
 * Uses fake timers to test TTL expiry without real waits.
 * Calls cacheInvalidate() in beforeEach because the cache is a module-level
 * singleton that persists across tests in the same worker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheSet, cacheInvalidate } from '@/lib/cache/queryCache'

const FIVE_MINUTES_MS = 5 * 60 * 1000

beforeEach(() => {
  cacheInvalidate()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('queryCache', () => {
  it('returns undefined on a cache miss', () => {
    expect(
      cacheGet('instances:https://dbpedia.org/sparql:http://example.org/Person'),
    ).toBeUndefined()
  })

  it('returns the stored value on a cache hit', () => {
    const instances = [
      { iri: 'http://dbpedia.org/resource/Albert_Einstein', label: 'Albert Einstein' },
    ]
    const key = 'instances:https://dbpedia.org/sparql:http://dbpedia.org/ontology/Scientist'
    cacheSet(key, instances)
    expect(cacheGet(key)).toEqual(instances)
  })

  it('default TTL is 5 minutes — valid just before, expired just after', () => {
    cacheSet('k', 'v') // no custom TTL → uses the app default
    vi.advanceTimersByTime(FIVE_MINUTES_MS - 1)
    expect(cacheGet('k')).toBe('v')
    vi.advanceTimersByTime(2)
    expect(cacheGet('k')).toBeUndefined()
  })

  it('cacheInvalidate removes all entries — prevents cross-endpoint data leakage', () => {
    // User has browsed classes on endpoint A
    cacheSet('instances:https://endpoint-a.org/sparql:http://example.org/Person', ['alice'])
    cacheSet('instances:https://endpoint-a.org/sparql:http://example.org/Movie', ['inception'])

    // User disconnects and connects to a different endpoint
    cacheInvalidate()

    expect(
      cacheGet('instances:https://endpoint-a.org/sparql:http://example.org/Person'),
    ).toBeUndefined()
    expect(
      cacheGet('instances:https://endpoint-a.org/sparql:http://example.org/Movie'),
    ).toBeUndefined()
  })

  it('entries added after cacheInvalidate are served normally', () => {
    cacheSet('instances:https://endpoint-a.org/sparql:http://example.org/Person', ['stale'])
    cacheInvalidate()
    cacheSet('instances:https://endpoint-b.org/sparql:http://example.org/Person', ['fresh'])
    expect(cacheGet('instances:https://endpoint-b.org/sparql:http://example.org/Person')).toEqual([
      'fresh',
    ])
  })
})
