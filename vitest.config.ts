import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Automatic JSX runtime so client .tsx render smoke tests transform without React in scope.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'scripts/**/*.test.ts',
      'client/**/*.test.ts',
      'client/**/*.test.tsx',
    ],
  },
});
