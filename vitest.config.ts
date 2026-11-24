import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // This machine reports 48 cores to the OS but has 7.7 GB RAM, so vitest's
    // default pool starves the jsdom shell suites and files time out at
    // random. Two workers is the largest pool this machine tolerates without
    // thrashing; CI with more memory can raise it with --maxWorkers.
    maxWorkers: 2,
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/.next/**', '**/.kilo/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    // The shell suites mount the whole App (header, dock, workspace, 3-D viewer
    // chunks) inside one jsdom instance per file. Measured alone the slowest
    // of those mounts takes 12.5 s, and pcb3dBuildBudget took 42 s in a full
    // run at the default 30 s cap — a budget signal, not an assertion: the
    // test still has to pass, and it does pass in isolation. On a loaded
    // machine (7.7 GB, other editors open) the same mounts have been measured
    // at 57 s and appShell's boot at 53–64 s, so 45 s is no longer headroom;
    // 120 s covers the measured worst case while still catching a genuine hang.
    testTimeout: 120000,
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
