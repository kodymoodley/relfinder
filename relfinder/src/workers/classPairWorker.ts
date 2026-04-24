/**
 * Web Worker: class-pair discovery.
 *
 * One worker instance handles one strategy.  The main thread spawns multiple
 * instances concurrently (one per strategy) so all strategies run in true
 * parallel background threads.
 *
 * Query execution uses a plain fetch against the SPARQL HTTP protocol — no
 * Comunica dependency — keeping the worker bundle small and worker-safe.
 */

import type { SparqlBinding, ClassPairWorkerInput, ClassPairWorkerOutput } from '@/lib/sparql/types'
import {
  strategyDirect1,
  strategyDirect2,
  strategyAnchor3,
  type StrategyConfig,
  type RunQuery,
} from '@/lib/sparql/classPairStrategies'

// ── SPARQL HTTP execution ──────────────────────────────────────────────────────

function makeFetchQuery(endpointUrl: string, authorizationHeader?: string): RunQuery {
  return async (query: string): Promise<SparqlBinding[]> => {
    const body = new URLSearchParams({ query })
    const headers: Record<string, string> = {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      // Prevent connection reuse so a dropped HTTP/2 stream only kills one request
      Connection: 'close',
    }
    if (authorizationHeader) headers['Authorization'] = authorizationHeader

    const res = await fetch(endpointUrl, { method: 'POST', headers, body: body.toString() })
    if (!res.ok) throw new Error(`SPARQL HTTP ${res.status}`)

    const json = await res.json()
    return (json.results?.bindings ?? []).map(
      (b: Record<string, { type: string; value: string; 'xml:lang'?: string }>) => {
        const row: SparqlBinding = {}
        for (const [k, v] of Object.entries(b)) {
          row[k] = { value: v.value, type: v.type, lang: v['xml:lang'] }
        }
        return row
      },
    )
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

function emit(msg: ClassPairWorkerOutput) {
  self.postMessage(msg)
}

self.onmessage = async (event: MessageEvent<ClassPairWorkerInput>) => {
  if (event.data.type !== 'start') return

  const { strategy, c1, c2, endpointUrl, authorizationHeader, offset, pairLimit, maxSubgraphNodes, allowedIntermediateTypes } =
    event.data

  const runQuery = makeFetchQuery(endpointUrl, authorizationHeader)
  const cfg: StrategyConfig = { c1, c2, offset, pairLimit, maxSubgraphNodes, allowedIntermediateTypes }

  try {
    const gen =
      strategy === 'direct-1' ? strategyDirect1(cfg, runQuery)
      : strategy === 'direct-2' ? strategyDirect2(cfg, runQuery)
      : strategyAnchor3(cfg, runQuery)

    for await (const pair of gen) {
      emit({ type: 'pair', pair })
    }
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }

  emit({ type: 'done' })
}
