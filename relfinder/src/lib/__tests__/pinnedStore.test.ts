// @vitest-environment node

/**
 * Unit tests for the pinned store.
 *
 * The pinned store backs the two-entity selection flow: the user pins
 * instances found in the Browse view (max 2), then navigates to the Graph
 * view where those pins become the start/end entities for path finding.
 *
 * Scenarios tested:
 *   pin / unpin / isPinned — add, remove, and query pins
 *   isFull guard — cannot pin a third entity once two are already pinned
 *   duplicate guard — pinning the same IRI twice is a no-op
 *   recordPair — recent path explorations are stored for quick replay
 *   history cap — only the 10 most recent pairs are retained
 *   clearPins vs clear — partial vs full reset on disconnect
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePinnedStore } from '@/stores/pinned'
import type { PinnedEntity } from '@/stores/pinned'

const ALICE: PinnedEntity = {
  iri: 'http://dbpedia.org/resource/Cillian_Murphy',
  label: 'Cillian Murphy',
  class: 'http://dbpedia.org/ontology/Actor',
}
const BOB: PinnedEntity = {
  iri: 'http://dbpedia.org/resource/Christopher_Nolan',
  label: 'Christopher Nolan',
  class: 'http://dbpedia.org/ontology/FilmDirector',
}
const CAROL: PinnedEntity = {
  iri: 'http://dbpedia.org/resource/Emma_Thomas',
  label: 'Emma Thomas',
  class: 'http://dbpedia.org/ontology/Person',
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// ── pin / isPinned / isFull ───────────────────────────────────────────────────

describe('pin', () => {
  it('adds an entity to the pin list', () => {
    const store = usePinnedStore()

    store.pin(ALICE)

    expect(store.pins).toHaveLength(1)
    expect(store.isPinned(ALICE.iri)).toBe(true)
  })

  it('allows pinning a second entity — both slots are available for path finding', () => {
    const store = usePinnedStore()

    store.pin(ALICE)
    store.pin(BOB)

    expect(store.pins).toHaveLength(2)
    expect(store.isFull).toBe(true)
  })

  it('does not add a third entity when both slots are occupied', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    store.pin(BOB)

    store.pin(CAROL)

    expect(store.pins).toHaveLength(2)
    expect(store.isPinned(CAROL.iri)).toBe(false)
  })

  it('ignores a duplicate pin — clicking "Pin" on an already-pinned entity is a no-op', () => {
    const store = usePinnedStore()
    store.pin(ALICE)

    store.pin(ALICE)

    expect(store.pins).toHaveLength(1)
  })
})

describe('isFull', () => {
  it('is false when no entities are pinned', () => {
    expect(usePinnedStore().isFull).toBe(false)
  })

  it('is false with one pin — user still needs to select the second entity', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    expect(store.isFull).toBe(false)
  })

  it('is true with two pins — Find Paths button becomes active', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    store.pin(BOB)
    expect(store.isFull).toBe(true)
  })
})

// ── unpin ─────────────────────────────────────────────────────────────────────

describe('unpin', () => {
  it('removes the specified entity so the user can swap it for another', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    store.pin(BOB)

    store.unpin(ALICE.iri)

    expect(store.isPinned(ALICE.iri)).toBe(false)
    expect(store.isPinned(BOB.iri)).toBe(true)
    expect(store.pins).toHaveLength(1)
  })

  it('is a no-op when the IRI is not pinned', () => {
    const store = usePinnedStore()
    store.pin(ALICE)

    store.unpin(CAROL.iri)

    expect(store.pins).toHaveLength(1)
  })
})

// ── recordPair ────────────────────────────────────────────────────────────────

describe('recordPair', () => {
  it('records a pair after the user launches path finding so they can replay it', () => {
    const store = usePinnedStore()

    store.recordPair(ALICE, BOB)

    expect(store.history).toHaveLength(1)
    expect(store.history[0].entity1.iri).toBe(ALICE.iri)
    expect(store.history[0].entity2.iri).toBe(BOB.iri)
  })

  it('prepends to history so the most recent exploration appears first', () => {
    const store = usePinnedStore()
    store.recordPair(ALICE, BOB)

    store.recordPair(BOB, CAROL)

    expect(store.history[0].entity1.iri).toBe(BOB.iri)
    expect(store.history[1].entity1.iri).toBe(ALICE.iri)
  })

  it('caps history at 10 entries — prevents unbounded memory growth in long sessions', () => {
    const store = usePinnedStore()

    for (let i = 0; i < 11; i++) {
      const e1: PinnedEntity = {
        iri: `http://example.org/Entity${i}`,
        label: `Entity ${i}`,
        class: 'http://example.org/Thing',
      }
      store.recordPair(e1, BOB)
    }

    expect(store.history).toHaveLength(10)
    // Most recent entry is first
    expect(store.history[0].entity1.iri).toBe('http://example.org/Entity10')
    // Oldest entry (Entity0) was evicted
    expect(store.history.some((p) => p.entity1.iri === 'http://example.org/Entity0')).toBe(false)
  })
})

// ── clearPins / clear ─────────────────────────────────────────────────────────

describe('clearPins', () => {
  it('removes all pins but keeps history — used when starting a new selection', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    store.pin(BOB)
    store.recordPair(ALICE, BOB)

    store.clearPins()

    expect(store.pins).toHaveLength(0)
    expect(store.history).toHaveLength(1)
  })
})

describe('clear', () => {
  it('resets pins and history on disconnect — the new endpoint starts with a blank slate', () => {
    const store = usePinnedStore()
    store.pin(ALICE)
    store.pin(BOB)
    store.recordPair(ALICE, BOB)

    store.clear()

    expect(store.pins).toHaveLength(0)
    expect(store.history).toHaveLength(0)
  })
})
