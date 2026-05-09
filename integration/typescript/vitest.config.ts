import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000, // live API calls take longer than mock tests
    include: ['*.test.ts'],
  },
});
