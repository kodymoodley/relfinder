import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Absolute path to our process shim — must be absolute so esbuild can
// resolve it from inside the optimizeDeps sandbox.
const processShim = fileURLToPath(new URL('./src/lib/process-shim.js', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // Polyfill Node.js built-ins for Comunica (buffer, events, stream, util).
    // 'process' is intentionally excluded here — we alias it to our own shim
    // (processShim above) so that nextTick is available. The upstream polyfill
    // from rollup-plugin-node-polyfills omits nextTick entirely.
    nodePolyfills({
      include: ['buffer', 'events', 'stream', 'util'],
      globals: { Buffer: true },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Route every `import … from 'process'` (in source files) to our shim.
      'process': processShim,
    },
  },
  optimizeDeps: {
    // Pre-bundle Comunica so Vite doesn't try to analyse its 500+ internal
    // modules individually on every cold start — dramatically speeds up dev HMR.
    include: ['@comunica/query-sparql'],
    esbuildOptions: {
      // Route every `require('process')` / `import … from 'process'` inside
      // the pre-bundled dep chunks (including readable-stream's separate chunk)
      // to our shim. This is the critical fix — the upstream process polyfill
      // bundled by rollup-plugin-node-polyfills lacks nextTick, which
      // readable-stream calls during stream setup.
      alias: { 'process': processShim },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Comunica is ~2MB — isolate it so the browser can cache it
          // independently of application code changes.
          comunica: ['@comunica/query-sparql'],
          // N3.js Turtle parser
          n3: ['n3'],
          // Cytoscape graph renderer
          cytoscape: ['cytoscape'],
          // PrimeVue component library
          primevue: ['primevue'],
        },
      },
    },
  },
})
