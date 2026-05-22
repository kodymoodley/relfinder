import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PinnedEntity {
  iri: string
  label: string
  /** rdf:type IRI of the class the entity was found under. */
  class: string
}

export interface ExploredPair {
  entity1: PinnedEntity
  entity2: PinnedEntity
  exploredAt: number
}

/** Maximum pins — matches the two-entity constraint in the graph view. */
const MAX_PINS = 2
const MAX_HISTORY = 10

export const usePinnedStore = defineStore('pinned', () => {
  const pins = ref<PinnedEntity[]>([])
  const history = ref<ExploredPair[]>([])

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

  function recordPair(entity1: PinnedEntity, entity2: PinnedEntity): void {
    history.value.unshift({ entity1, entity2, exploredAt: Date.now() })
    if (history.value.length > MAX_HISTORY) {
      history.value = history.value.slice(0, MAX_HISTORY)
    }
  }

  function clearPins(): void {
    pins.value = []
  }

  function clear(): void {
    pins.value = []
    history.value = []
  }

  return { pins, history, isFull, isPinned, pin, unpin, recordPair, clearPins, clear }
})
