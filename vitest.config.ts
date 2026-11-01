import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // CLI entry points only parse env and call tested code; they are checked by running them
      exclude: ['src/index.ts', 'src/scripts/**'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
