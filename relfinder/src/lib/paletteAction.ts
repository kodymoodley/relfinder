import { ref } from 'vue'

// One-shot signals written by CommandPalette and consumed (cleared) by BrowseView / GraphView.
// Using reactive refs avoids history.state timing issues with same-route navigation.
export const paletteNodeIri = ref<string | null>(null)
export const palettePropertyIri = ref<string | null>(null)

/** Set to open NodeDetail in GraphView for this instance without building a graph. */
export const palettePreviewEntity = ref<{
  iri: string
  label: string
  class: string
} | null>(null)

/** One-shot preset for both graph entity slots. Works whether GraphView is freshly
 *  mounted, activated from keep-alive, or already the active view (same-route navigation). */
export const graphPreset = ref<{
  entity1: { iri: string; label: string; class: string }
  entity2: { iri: string; label: string; class: string }
} | null>(null)
