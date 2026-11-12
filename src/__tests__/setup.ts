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

// The standalone build gates project creation behind a local profile; the
// shell suites boot as a signed-in local owner by default so the gate is
// invisible to them. The gate suite clears this in its own setup.
beforeEach(() => {
  useLocalProfileStore.setState({ profile: { name: 'Test User', email: 'test@folio.app' } });
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
