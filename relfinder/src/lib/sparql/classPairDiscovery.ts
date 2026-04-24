/**
 * Class-pair discovery orchestrator.
 *
 * Endpoint mode  — spawns one Web Worker per strategy so all strategies run in
 *                  true parallel background threads.
 * Local-file mode — runs the same strategy generators as concurrent async tasks
 *                   on the main thread (workers can't access the N3 in-memory
 *                   store, but in-memory queries are fast enough).
 *
 * Results are deduplicated across strategies and delivered via onPair as soon
 * as each pair is found — the caller doesn't wait for all strategies to finish.
 */

import type { Store } from 'n3'
import type {
  QueryContext,
  DiscoveredPair,
  ClassPairStrategy,
  ClassPairWorkerInput,
  ClassPairWorkerOutput,
  SparqlBinding,
} from './types'
import { executeSelectOnStore } from './engine'
import {
  strategyDirect2,
  strategyAnchor3,
  type StrategyConfig,
  type RunQuery,
} from './classPairStrategies'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  maxDistance?: number
  /** Pairs each strategy should aim to find (pool size = strategies × pairLimit). */
  pairLimit?: number
  /** OFFSET multiplier — increment to regenerate without re-running from zero. */
  offset?: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pairKey(e1: string, e2: string): string {
  return e1 < e2 ? `${e1}\0${e2}` : `${e2}\0${e1}`
}

function strategiesFor(maxDistance: number): ClassPairStrategy[] {
  const s: ClassPairStrategy[] = []
  if (maxDistance >= 2) s.push('direct-2')
  if (maxDistance >= 3) s.push('anchor-3')
  return s
}

// ── Endpoint mode: Web Workers ────────────────────────────────────────────────

function spawnWorker(
  strategy: ClassPairStrategy,
  c1: string,
  c2: string,
  context: QueryContext,
  cfg: StrategyConfig,
  onPair: (pair: DiscoveredPair) => void,
  onDone: () => void,
): Worker {
  const worker = new Worker(
    new URL('@/workers/classPairWorker.ts', import.meta.url),
    { type: 'module' },
  )

  const msg: ClassPairWorkerInput = {
    type: 'start',
    strategy,
    c1,
    c2,
    endpointUrl: context.endpointUrl,
    authorizationHeader: context.authorizationHeader,
    offset: cfg.offset,
    pairLimit: cfg.pairLimit,
    maxSubgraphNodes: cfg.maxSubgraphNodes,
  }

  worker.postMessage(msg)

  worker.onmessage = (e: MessageEvent<ClassPairWorkerOutput>) => {
    if (e.data.type === 'pair') onPair(e.data.pair)
    else if (e.data.type === 'done') { worker.terminate(); onDone() }
    else if (e.data.type === 'error') {
      console.warn(`[classPair/${strategy}]`, e.data.message)
      worker.terminate()
      onDone()
    }
  }

  worker.onerror = (e) => {
    console.warn(`[classPair/${strategy}] worker crash`, e.message)
    worker.terminate()
    onDone()
  }

  return worker
}

// ── File mode: concurrent async generators ────────────────────────────────────

function makeComunicaQuery(store: Store): RunQuery {
  return (query: string): Promise<SparqlBinding[]> => executeSelectOnStore(query, store)
}

async function runGen(
  gen: AsyncGenerator<DiscoveredPair>,
  onPair: (pair: DiscoveredPair) => void,
  cancelRef: { cancelled: boolean },
  onDone: () => void,
) {
  try {
    for await (const pair of gen) {
      if (cancelRef.cancelled) break
      onPair(pair)
    }
  } catch (err) {
    console.warn('[classPairDiscovery] file-mode strategy error', err)
  }
  onDone()
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

/**
 * Starts discovery of entity pairs connecting instances of c1 and c2.
 *
 * @returns A cancel function — call it to terminate all workers / generators.
 */
export function discoverClassPairs(
  c1: string,
  c2: string,
  context: QueryContext | null,
  store: Store | undefined,
  options: DiscoveryOptions,
  onPair: (pair: DiscoveredPair) => void,
  onComplete: () => void,
): () => void {
  const maxDistance = options.maxDistance ?? 3
  const pairLimit = options.pairLimit ?? 6
  const offset = options.offset ?? 0
  const maxSubgraphNodes = 50

  const strategies = strategiesFor(maxDistance)
  const seen = new Set<string>()
  const cancelRef = { cancelled: false }
  let doneCount = 0
  const workers: Worker[] = []

  function handlePair(pair: DiscoveredPair) {
    if (cancelRef.cancelled) return
    const key = pairKey(pair.entity1.iri, pair.entity2.iri)
    if (seen.has(key)) return
    seen.add(key)
    onPair(pair)
  }

  function handleDone() {
    if (cancelRef.cancelled) return
    doneCount++
    if (doneCount === strategies.length) onComplete()
  }

  const cfg: StrategyConfig = { c1, c2, offset, pairLimit, maxSubgraphNodes }

  if (store) {
    const runQuery = makeComunicaQuery(store)
    if (maxDistance >= 2) runGen(strategyDirect2(cfg, runQuery), handlePair, cancelRef, handleDone)
    if (maxDistance >= 3) runGen(strategyAnchor3(cfg, runQuery), handlePair, cancelRef, handleDone)
  } else {
    const ctx = context ?? { endpointUrl: '' }
    for (const strategy of strategies) {
      const w = spawnWorker(strategy, c1, c2, ctx, cfg, handlePair, handleDone)
      workers.push(w)
    }
  }

  return () => {
    cancelRef.cancelled = true
    workers.forEach(w => w.terminate())
  }
}
