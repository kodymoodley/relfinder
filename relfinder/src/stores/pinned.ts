import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PinnedEntity {
  iri: string
  label: string
  /** rdf:type IRI of the class the entity was found under. */
  class: string
}

/** Maximum pins — matches the two-entity constraint in the graph view. */
const MAX_PINS = 2

export const usePinnedStore = defineStore('pinned', () => {
  const pins = ref<PinnedEntity[]>([])

  const isFull = computed(() => pins.value.length >= MAX_PINS)

  function isPinned(iri: string): boolean {
    return pins.value.some((p) => p.iri === iri)
  }

  function pin(entity: PinnedEntity): void {
    if (isFull.value || isPinned(entity.iri)) return
    pins.value.push(entity)
  }

  function unpin(iri: string): void {
    pins.value = pins.value.filter((p) => p.iri !== iri)
  }

  function clear(): void {
    pins.value = []
  }

  return { pins, isFull, isPinned, pin, unpin, clear }
})
