import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // Required for Comunica: polyfills Node.js built-ins (stream, events, buffer,
    // util) that Comunica references internally but are not available in the browser.
    nodePolyfills({
      // Only polyfill what Comunica actually needs — keeps bundle lean
      include: ['buffer', 'events', 'stream', 'util', 'process'],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // Pre-bundle Comunica so Vite doesn't try to analyse its 500+ internal
    // modules individually on every cold start — dramatically speeds up dev HMR.
    include: ['@comunica/query-sparql'],
  },
})
