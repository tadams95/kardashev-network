import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Phase 2 μ correction: tests assert the LEGACY biasCorrection path's
      // behavior (uniform shift of all sources by a scalar). Production
      // default is MU_CORRECTION_ENABLED=true which ignores the scalar and
      // uses per-source μ instead. Force legacy path for tests so existing
      // assertions stay valid. New tests for the μ path can override this
      // locally via `import.meta.env` or `process.env` manipulation.
      // See docs/work/phase-2-mu-correction-plan.md.
      MU_CORRECTION_ENABLED: 'false',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
