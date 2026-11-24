// Test setup file
import { afterEach, beforeEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useLocalProfileStore } from '../stores/useLocalProfileStore';

/*
 * 208 files run on a saturated machine, so a React flush that is
 * deterministic can still take longer than testing-library's 1 s default and
 * report a timeout as if the component were broken. The wait is only for the
 * scheduler; the assertions still describe the rendered result.
 */
configure({ asyncUtilTimeout: 4000 });

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// The standalone build boots as a local owner by default; the shell suites
// seed one here so the first-run identity path stays invisible to them.
// standaloneBoot.test.tsx clears this in its own setup.
beforeEach(() => {
  useLocalProfileStore.setState({
    profiles: [{ id: 'test-profile', name: 'Test User', createdAt: Date.now() }],
    activeProfileId: 'test-profile',
  });
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;
