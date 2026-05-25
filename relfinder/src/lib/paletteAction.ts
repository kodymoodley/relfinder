import { ref } from 'vue'

// One-shot signals written by CommandPalette and consumed (cleared) by BrowseView.
// Using reactive refs avoids history.state timing issues with same-route navigation.
export const paletteNodeIri = ref<string | null>(null)
export const palettePropertyIri = ref<string | null>(null)
