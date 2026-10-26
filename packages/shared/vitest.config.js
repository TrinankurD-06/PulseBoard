import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    // The first run downloads a MongoDB binary, which can take a while.
    hookTimeout: 120_000,
    testTimeout: 20_000,
    coverage: {
      include: ['src/**/*.js'],
      exclude: ['src/testing/**', 'src/models/**', 'src/index.js', 'src/logger.js'],
    },
  },
});
