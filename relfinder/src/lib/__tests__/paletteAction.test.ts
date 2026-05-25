/**
 * Tests for the reactive one-shot signals in the navigation store.
 *
 * These signals are the mechanism that lets CommandPalette, BrowseView, and
 * GraphView coordinate without coupling through history.state. The core
 * contract being verified:
 *
 *   - Each signal is a store ref — all consumers share the same instance.
 *   - Signals are consumed (set to null) by the reader after processing.
 *   - A watcher with { immediate: true } picks up a pre-set value on mount
 *     (critical for the "already-on-the-route" same-route navigation case).
 *   - Setting one signal never disturbs the others.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { watch, nextTick, type Ref } from 'vue'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { useNavigationStore } from '@/stores/navigation'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const alice = { iri: 'http://e.org/Alice', label: 'Alice', class: 'http://e.org/Person' }
const bob = { iri: 'http://e.org/Bob', label: 'Bob', class: 'http://e.org/Person' }

type Entity = typeof alice
type Preset = { entity1: Entity; entity2: Entity }

const preset = (e1: Entity = alice, e2: Entity = bob): Preset => ({ entity1: e1, entity2: e2 })

let graphPreset: Ref<Preset | null>
let palettePreviewEntity: Ref<Entity | null>
let paletteNodeIri: Ref<string | null>
let palettePropertyIri: Ref<string | null>
let pathStartEntity: Ref<Entity | null>

beforeEach(() => {
  setActivePinia(createPinia())
  ;({ graphPreset, palettePreviewEntity, paletteNodeIri, palettePropertyIri, pathStartEntity } =
    storeToRefs(useNavigationStore()))
})

// ── graphPreset ───────────────────────────────────────────────────────────────

describe('graphPreset', () => {
  it('starts as null', () => {
    expect(graphPreset.value).toBeNull()
  })

  it('stores both entity slots', () => {
    graphPreset.value = preset()
    expect(graphPreset.value?.entity1.iri).toBe(alice.iri)
    expect(graphPreset.value?.entity2.iri).toBe(bob.iri)
  })

  it('notifies a watcher when set', async () => {
    const seen: (typeof graphPreset.value)[] = []
    const stop = watch(graphPreset, (v) => seen.push(v))

    graphPreset.value = preset()
    await nextTick()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.entity1.iri).toBe(alice.iri)
    stop()
  })

  // ── Same-route navigation simulation ─────────────────────────────────────
  // GraphView uses { immediate: true } so it fires whether the view is freshly
  // mounted or already active when graphPreset changes.

  it('{ immediate: true } watcher sees a pre-set value on "mount"', async () => {
    graphPreset.value = preset() // set before "mount"

    const applied: Array<NonNullable<typeof graphPreset.value>> = []
    const stop = watch(
      graphPreset,
      (v) => {
        if (v) applied.push(v)
      },
      { immediate: true },
    )
    await nextTick()

    expect(applied[0]?.entity1.iri).toBe(alice.iri)
    stop()
  })

  it('fires again when graphPreset is updated while watcher is active (same-route)', async () => {
    const carol = { iri: 'http://e.org/Carol', label: 'Carol', class: 'http://e.org/Person' }
    const applyLog: string[] = []

    const stop = watch(
      graphPreset,
      (v) => {
        if (v) {
          graphPreset.value = null
          applyLog.push(v.entity1.iri)
        }
      },
      { immediate: true },
    )

    // First "navigation" to /graph
    graphPreset.value = preset(alice, bob)
    await nextTick()

    // Second "navigation" while GraphView already active (same route — no onActivated)
    graphPreset.value = preset(carol, bob)
    await nextTick()

    expect(applyLog).toEqual([alice.iri, carol.iri])
    stop()
  })

  it('is consumed exactly once — already-null preset is a no-op on re-watch', async () => {
    let applyCount = 0

    const stop1 = watch(
      graphPreset,
      (v) => {
        if (v) {
          graphPreset.value = null
          applyCount++
        }
      },
      { immediate: true },
    )
    graphPreset.value = preset()
    await nextTick()

    expect(applyCount).toBe(1)
    expect(graphPreset.value).toBeNull()

    // Simulate keep-alive deactivation / re-activation of GraphView:
    // watcher is stopped then restarted. With keep-alive the component stays
    // mounted, but the same result holds — re-watch sees null, guard fires.
    stop1()
    const stop2 = watch(
      graphPreset,
      (v) => {
        if (v) {
          graphPreset.value = null
          applyCount++
        }
      },
      { immediate: true },
    )
    await nextTick()

    expect(applyCount).toBe(1) // NOT applied a second time
    stop2()
  })

  it('last write wins when set twice before watcher flush', async () => {
    const carol = { iri: 'http://e.org/Carol', label: 'Carol', class: 'http://e.org/Person' }
    const applied: string[] = []

    const stop = watch(graphPreset, (v) => {
      if (v) applied.push(v.entity1.iri)
    })

    graphPreset.value = preset(alice, bob) // immediately overwritten
    graphPreset.value = preset(carol, bob)
    await nextTick()

    expect(applied).toEqual([carol.iri]) // only final value, fired once
    stop()
  })

  it('clearing inside the consuming watcher does not double-fire the non-null branch', async () => {
    let applyCount = 0

    const stop = watch(graphPreset, (v) => {
      if (!v) return
      applyCount++
      graphPreset.value = null // consume
    })

    graphPreset.value = preset()
    await nextTick()

    expect(applyCount).toBe(1)
    stop()
  })

  // ── Entity slot independence ───────────────────────────────────────────────

  it('entity1 and entity2 are stored independently', () => {
    const carol = { iri: 'http://e.org/Carol', label: 'Carol', class: 'http://e.org/Org' }
    graphPreset.value = preset(alice, carol)

    expect(graphPreset.value?.entity1.iri).toBe(alice.iri)
    expect(graphPreset.value?.entity2.iri).toBe(carol.iri)
    // class fields are preserved
    expect(graphPreset.value?.entity1.class).toBe('http://e.org/Person')
    expect(graphPreset.value?.entity2.class).toBe('http://e.org/Org')
  })
})

// ── Signal independence ───────────────────────────────────────────────────────

describe('signal independence', () => {
  it('setting graphPreset does not affect palettePreviewEntity', async () => {
    const changes: (typeof palettePreviewEntity.value)[] = []
    const stop = watch(palettePreviewEntity, (v) => changes.push(v))

    graphPreset.value = preset()
    await nextTick()

    expect(changes).toHaveLength(0)
    stop()
  })

  it('setting palettePreviewEntity does not affect graphPreset', async () => {
    const changes: (typeof graphPreset.value)[] = []
    const stop = watch(graphPreset, (v) => changes.push(v))

    palettePreviewEntity.value = alice
    await nextTick()

    expect(changes).toHaveLength(0)
    stop()
  })

  it('setting paletteNodeIri does not affect graphPreset', async () => {
    const changes: (typeof graphPreset.value)[] = []
    const stop = watch(graphPreset, (v) => changes.push(v))

    paletteNodeIri.value = 'http://e.org/Person'
    await nextTick()

    expect(changes).toHaveLength(0)
    stop()
  })

  it('all four signals can be set concurrently without cross-contamination', async () => {
    graphPreset.value = preset()
    palettePreviewEntity.value = alice
    paletteNodeIri.value = 'http://e.org/Person'
    palettePropertyIri.value = 'http://e.org/knows'

    expect(graphPreset.value?.entity1.iri).toBe(alice.iri)
    expect(palettePreviewEntity.value?.iri).toBe(alice.iri)
    expect(paletteNodeIri.value).toBe('http://e.org/Person')
    expect(palettePropertyIri.value).toBe('http://e.org/knows')
  })
})

// ── palettePreviewEntity ──────────────────────────────────────────────────────

describe('palettePreviewEntity', () => {
  it('starts as null', () => {
    expect(palettePreviewEntity.value).toBeNull()
  })

  it('{ immediate: true } watcher picks up a value set before "mount"', async () => {
    palettePreviewEntity.value = alice

    const seen: Array<NonNullable<typeof palettePreviewEntity.value>> = []
    const stop = watch(
      palettePreviewEntity,
      (v) => {
        if (v) seen.push(v)
      },
      { immediate: true },
    )
    await nextTick()

    expect(seen[0]?.iri).toBe(alice.iri)
    stop()
  })

  it('consuming the preview entity (setting null) does not affect pathStartEntity', async () => {
    // palettePreviewEntity and pathStartEntity are independent store properties.
    // Viewing an entity info pane must not disturb a pending "Set as start" selection.
    pathStartEntity.value = alice

    palettePreviewEntity.value = bob
    palettePreviewEntity.value = null // consumed by GraphView

    expect(pathStartEntity.value?.iri).toBe(alice.iri) // unaffected
  })
})
