import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    hookTimeout: 120_000,
    testTimeout: 20_000,
    // Integration test files each start their own in-memory MongoDB.
    fileParallelism: false,
  },
});
