import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.kilo/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    // The shell suites mount the whole App (header, dock, workspace, 3-D viewer
    // chunks) inside one jsdom instance per file, and 301 of those files run
    // concurrently. Measured alone the slowest of those mounts takes 12.5 s, so
    // a 10 s cap is a coin flip under suite contention rather than a signal
    // about the code: it has failed three different shell tests in three runs
    // while each passed in isolation. Per-test budgets are therefore not a fix;
    // the file that needs the headroom is the whole shell suite.
    testTimeout: 30000,
    hookTimeout: 10000,
    typecheck: {
      enabled: false
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
});
