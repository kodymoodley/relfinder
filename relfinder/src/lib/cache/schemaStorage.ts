/**
 * Persistent schema cache backed by localStorage.
 *
 * One entry per endpoint URL, keyed by `rf:schema:v1:<url>`.
 * Entries expire after TTL_MS (7 days). Version mismatches are silently
 * discarded so a schema format change never causes a parse error.
 * QuotaExceededError is caught and ignored — the app degrades gracefully to
 * in-memory-only caching when storage is full.
 */

import type { SchemaNode, SchemaEdge, SchemaDataProp } from '@/lib/sparql/types'

const SCHEMA_VERSION = 1
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const KEY_PREFIX = 'rf:schema:v1:'

export interface PersistedSchema {
  version: number
  endpointUrl: string
  savedAt: number
  classLimit: number
  edgeLimit: number
  nodes: SchemaNode[]
  edges: SchemaEdge[]
  /** IRIs of classes whose Phase-2 edge query has completed. */
  processedClassIris: string[]
  /** Map<classIri, SchemaDataProp[]> serialised as entries array. */
  dataPropsCache: [string, SchemaDataProp[]][]
  /** Map<classIri, description string> serialised as entries array. */
  descriptionCache: [string, string][]
}

function storageKey(endpointUrl: string): string {
  return `${KEY_PREFIX}${endpointUrl}`
}

export function saveSchema(endpointUrl: string, data: PersistedSchema): void {
  try {
    localStorage.setItem(storageKey(endpointUrl), JSON.stringify(data))
  } catch {
    // QuotaExceededError or SecurityError — silently skip
  }
}

export function loadSchema(endpointUrl: string): PersistedSchema | null {
  try {
    const raw = localStorage.getItem(storageKey(endpointUrl))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedSchema
    if (parsed.version !== SCHEMA_VERSION) {
      localStorage.removeItem(storageKey(endpointUrl))
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(storageKey(endpointUrl))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearSchema(endpointUrl: string): void {
  try {
    localStorage.removeItem(storageKey(endpointUrl))
  } catch {
    // ignore
  }
}
