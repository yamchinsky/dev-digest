import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Cross-package contract source — same targets as tsconfig paths.
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
