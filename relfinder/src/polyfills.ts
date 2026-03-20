/**
 * Browser polyfills that must be applied before any Comunica module evaluates.
 *
 * Comunica's stream dependencies (readable-stream, etc.) call process.nextTick
 * for scheduling. The browser has no process.nextTick, so we alias it to
 * queueMicrotask which provides equivalent semantics (microtask queue).
 *
 * Import this file as the very first side-effect import in main.ts so it runs
 * before any other module in the dependency graph.
 */

const g = globalThis as Record<string, unknown>

if (!g['process']) {
  g['process'] = { env: {}, nextTick: queueMicrotask }
} else {
  const proc = g['process'] as Record<string, unknown>
  if (typeof proc['nextTick'] !== 'function') {
    proc['nextTick'] = queueMicrotask
  }
}
