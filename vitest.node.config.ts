import { defineConfig } from 'vitest/config';

// Shared logic and the Electron main-process specs are plain TypeScript and
// Node APIs; none of them use Angular or TestBed, so they run here rather than
// through `ng test`.
export default defineConfig({
  test: {
    include: ['shared/**/*.spec.ts', 'electron/**/*.spec.ts'],
    environment: 'node',
    globals: true,
  },
});
