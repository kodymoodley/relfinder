import { ref } from 'vue'

/** Shared start-entity state for the two-step "Set as start → Find path" flow.
 *  Written by CommandPalette and SchemaDetailPanel; persists across palette open/close. */
export const pathStartEntity = ref<{ iri: string; label: string; class: string } | null>(null)
