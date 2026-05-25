import { describe, it, expect, beforeEach } from 'vitest'
import { watch, nextTick } from 'vue'
import { pathStartEntity } from '../pathStart'

// ── Helpers ───────────────────────────────────────────────────────────────────

const alice = { iri: 'http://e.org/Alice', label: 'Alice', class: 'http://e.org/Person' }
const bob = { iri: 'http://e.org/Bob', label: 'Bob', class: 'http://e.org/Person' }

beforeEach(() => {
  pathStartEntity.value = null
})

// ── Basic state contract ──────────────────────────────────────────────────────

describe('pathStartEntity', () => {
  it('initialises to null', () => {
    expect(pathStartEntity.value).toBeNull()
  })

  it('can be set to an entity', () => {
    pathStartEntity.value = alice
    expect(pathStartEntity.value).toEqual(alice)
  })

  it('can be cleared back to null', () => {
    pathStartEntity.value = alice
    pathStartEntity.value = null
    expect(pathStartEntity.value).toBeNull()
  })

  it('last write wins when set twice in the same tick', () => {
    pathStartEntity.value = alice
    pathStartEntity.value = bob
    expect(pathStartEntity.value?.iri).toBe(bob.iri)
  })

  // ── Singleton / shared-state contract ───────────────────────────────────────
  // These tests simulate two components (Palette and SchemaDetailPanel) each
  // holding a reference to the same module-level ref.

  it('a write from "ComponentA" is immediately visible to "ComponentB"', () => {
    // Simulated write from CommandPalette
    const writeFromPalette = () => {
      pathStartEntity.value = alice
    }

    // Simulated read from SchemaDetailPanel
    const readFromPanel = () => pathStartEntity.value

    writeFromPalette()
    expect(readFromPanel()?.iri).toBe(alice.iri)
  })

  it('a clear from "ComponentA" is immediately visible to "ComponentB"', () => {
    pathStartEntity.value = alice

    // Palette clears after finding a path
    pathStartEntity.value = null

    // Panel should see null too
    expect(pathStartEntity.value).toBeNull()
  })

  // ── Reactivity ────────────────────────────────────────────────────────────

  it('notifies a watcher when set', async () => {
    const seen: (typeof pathStartEntity.value)[] = []
    const stop = watch(pathStartEntity, (v) => seen.push(v))

    pathStartEntity.value = alice
    await nextTick()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.iri).toBe(alice.iri)
    stop()
  })

  it('notifies a watcher when cleared', async () => {
    pathStartEntity.value = alice
    await nextTick()

    const seen: Array<{ iri: string; label: string; class: string } | null> = []
    const stop = watch(pathStartEntity, (v) => seen.push(v ?? null))

    pathStartEntity.value = null
    await nextTick()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeNull()
    stop()
  })

  it('notifies multiple independent watchers simultaneously', async () => {
    const seenA: boolean[] = []
    const seenB: boolean[] = []

    const stopA = watch(pathStartEntity, (v) => seenA.push(v !== null))
    const stopB = watch(pathStartEntity, (v) => seenB.push(v !== null))

    pathStartEntity.value = alice
    await nextTick()

    expect(seenA).toEqual([true])
    expect(seenB).toEqual([true])

    stopA()
    stopB()
  })

  it('an immediate watcher reads the current value at setup time', async () => {
    pathStartEntity.value = alice

    const seen: Array<NonNullable<typeof pathStartEntity.value>> = []
    const stop = watch(
      pathStartEntity,
      (v) => {
        if (v) seen.push(v)
      },
      { immediate: true },
    )
    await nextTick()

    // Fired once synchronously with the current value
    expect(seen[0]?.iri).toBe(alice.iri)
    stop()
  })

  it('coalesces rapid successive writes — watcher fires once with the final value', async () => {
    const seen: (typeof pathStartEntity.value)[] = []
    const stop = watch(pathStartEntity, (v) => seen.push(v))

    pathStartEntity.value = alice
    pathStartEntity.value = bob // overwrites before watcher flush
    await nextTick()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.iri).toBe(bob.iri)
    stop()
  })

  // ── One-shot / consumption pattern ────────────────────────────────────────
  // The consuming watcher (e.g. onFindPath) clears the ref as it processes it.

  it('a consuming watcher clears the ref, making subsequent reads see null', async () => {
    const stop = watch(pathStartEntity, (v) => {
      if (!v) return
      pathStartEntity.value = null // consume it
    })

    pathStartEntity.value = alice
    await nextTick()

    expect(pathStartEntity.value).toBeNull()
    stop()
  })

  it('clearing inside a watcher does not trigger a second meaningful watcher call', async () => {
    const nonNullFirings: number[] = []

    const stop = watch(pathStartEntity, (v) => {
      if (!v) return // guard: ignore the null-back write
      nonNullFirings.push(1)
      pathStartEntity.value = null
    })

    pathStartEntity.value = alice
    await nextTick()

    expect(nonNullFirings).toHaveLength(1)
    stop()
  })
})
