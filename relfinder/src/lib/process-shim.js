/**
 * Minimal browser-compatible `process` shim.
 *
 * Used in place of rollup-plugin-node-polyfills/polyfills/process-es6, which
 * deliberately omits process.nextTick. Comunica's readable-stream dependency
 * calls process.nextTick for scheduling; without it the stream pipeline throws.
 *
 * Aliased to 'process' in both resolve.alias (source transforms) and
 * optimizeDeps.esbuildOptions.alias (pre-bundled dep chunks) in vite.config.ts.
 */

function noop() {}

export function nextTick(fn) {
  var args = Array.prototype.slice.call(arguments, 1)
  queueMicrotask(function () { fn.apply(null, args) })
}

export var env = {}
export var platform = 'browser'
export var argv = []
export var version = ''
export var versions = {}
export var on = noop
export var addListener = noop
export var once = noop
export var off = noop
export var removeListener = noop
export var removeAllListeners = noop
export var emit = noop
export var prependListener = noop
export var prependOnceListener = noop
export function listeners() { return [] }
export function cwd() { return '/' }
export function chdir() { throw new Error('process.chdir is not supported') }
export function umask() { return 0 }

var process = {
  nextTick: nextTick,
  env: env,
  platform: platform,
  argv: argv,
  version: version,
  versions: versions,
  on: noop,
  addListener: noop,
  once: noop,
  off: noop,
  removeListener: noop,
  removeAllListeners: noop,
  emit: noop,
  prependListener: noop,
  prependOnceListener: noop,
  listeners: listeners,
  cwd: cwd,
  chdir: chdir,
  umask: umask,
}

export default process
