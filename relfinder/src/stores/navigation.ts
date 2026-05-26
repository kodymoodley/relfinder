import { ref } from 'vue'
import { defineStore } from 'pinia'

type EntitySlot = { iri: string; label: string; class: string }

/**
 * One-shot navigation signals shared across CommandPalette, BrowseView,
 * GraphView, and SchemaDetailPanel. Using a Pinia store makes these visible
 * in Vue DevTools and keeps cross-route state out of the lib layer.
 *
 * Each signal is written by one component and consumed (cleared to null) by
 * the receiving component. Watchers use { immediate: true } so they fire
 * whether the target view is freshly mounted or already active (keep-alive).
 */
export const useNavigationStore = defineStore('navigation', () => {
  /** Written by CommandPalette; consumed by BrowseView to select a schema class node. */
  const paletteNodeIri = ref<string | null>(null)

  /** Written by CommandPalette; consumed by BrowseView to select a schema property edge. */
  const palettePropertyIri = ref<string | null>(null)

  /** Written by CommandPalette; consumed by GraphView to open NodeDetail for an instance. */
  const palettePreviewEntity = ref<EntitySlot | null>(null)

  /** Written by CommandPalette or SchemaDetailPanel; consumed by GraphView to preset both entity slots. */
  const graphPreset = ref<{ entity1: EntitySlot; entity2: EntitySlot } | null>(null)

  /** Shared start-entity for the two-step "Set as start → Find path" flow. */
  const pathStartEntity = ref<EntitySlot | null>(null)

  return { paletteNodeIri, palettePropertyIri, palettePreviewEntity, graphPreset, pathStartEntity }
})
