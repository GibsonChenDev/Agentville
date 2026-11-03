import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts', 'scripts/**/*.test.ts', 'server/relay/src/**/*.test.ts'],
    environment: 'node',
  },
});
