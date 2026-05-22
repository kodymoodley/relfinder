import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**', 'tests/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'istanbul',
        include: ['src/lib/**/*.ts', 'src/stores/**/*.ts'],
        exclude: ['src/lib/__tests__/**'],
        reporter: ['text', 'html'],
        reportsDirectory: './coverage',
      },
    },
  }),
)
