import { defineConfig } from 'vitest/config'

// Tests des Security Rules : exécutés contre les émulateurs Firebase (npm run test:rules).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
})
