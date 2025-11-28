import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Mock EventEmitter
vi.mock('events', () => ({
  EventEmitter: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

// Cleanup after each test case
afterEach(() => {
  cleanup();
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

// Mock WebXR
Object.defineProperty(navigator, 'xr', {
  writable: true,
  value: undefined,
});

