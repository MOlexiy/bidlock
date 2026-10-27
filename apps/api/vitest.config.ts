import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // tests share one real Postgres database
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
