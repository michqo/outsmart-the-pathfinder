import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  build: {
    // three.js is most of the bundle; it gets its own long-cached chunk.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
