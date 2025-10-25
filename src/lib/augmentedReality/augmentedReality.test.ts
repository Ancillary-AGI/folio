import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AugmentedRealityManager } from './augmentedReality';

// Mock THREE.js
vi.mock('three', () => ({
  Vector3: vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
  Euler: vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
  Scene: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
  PerspectiveCamera: vi.fn().mockImplementation(() => ({
    position: { x: 0, y: 0, z: 0 },
  })),
  WebGLRenderer: vi.fn().mockImplementation(() => ({
    xr: {
      enabled: false,
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(),
    },
    render: vi.fn(),
    dispose: vi.fn(),
  })),
  HemisphereLight: vi.fn(),
}));

describe('AugmentedRealityManager', () => {
  let manager: AugmentedRealityManager;

  beforeEach(() => {
    manager = new AugmentedRealityManager();
  });

  describe('initializeAR', () => {
    it('should return false when WebXR is not supported', async () => {
      // Mock navigator.xr as undefined
      Object.defineProperty(navigator, 'xr', {
        value: undefined,
        writable: true,
      });

      const result = await manager.isARSupported();
      expect(result).toBe(false);
    });

    it('should return true when WebXR is supported', async () => {
      // Mock navigator.xr
      const mockXR = {
        isSessionSupported: vi.fn().mockResolvedValue(true),
      };
      Object.defineProperty(navigator, 'xr', {
        value: mockXR,
        writable: true,
      });

      const result = await manager.isARSupported();
      expect(result).toBe(true);
    });
  });

  describe('createDesignPreview', () => {
    it('should create a design preview with correct structure', () => {
      const previewData = {
        name: 'Test Preview',
        circuitId: 'circuit-123',
        markers: [],
        lighting: {
          intensity: 1,
          color: '#ffffff',
          shadows: true,
        },
        interactions: {
          pinchToZoom: true,
          dragToMove: true,
          tapToSelect: true,
        },
        overlays: {
          measurements: true,
          grid: false,
          annotations: true,
        },
      };

      const preview = manager.createDesignPreview(previewData);

      expect(preview).toHaveProperty('id');
      expect(preview.name).toBe('Test Preview');
      expect(preview.circuitId).toBe('circuit-123');
      expect(preview.markers).toEqual([]);
      expect(preview.lighting.intensity).toBe(1);
    });
  });

  describe('addMarkerToPreview', () => {
    it('should add a marker to an existing preview', () => {
      const preview = manager.createDesignPreview({
        name: 'Test Preview',
        circuitId: 'circuit-123',
        markers: [],
        lighting: { intensity: 1, color: '#ffffff', shadows: true },
        interactions: { pinchToZoom: true, dragToMove: true, tapToSelect: true },
        overlays: { measurements: true, grid: false, annotations: true },
      });

      const markerData = {
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        type: 'component' as const,
        data: { componentId: 'comp-1' },
        visible: true,
      };

      const marker = manager.addMarkerToPreview(preview.id, markerData);

      expect(marker).toBeDefined();
      expect(marker?.id).toBeDefined();
      expect(marker?.type).toBe('component');
      expect(marker?.data).toEqual({ componentId: 'comp-1' });
    });

    it('should return null for non-existent preview', () => {
      const markerData = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        type: 'component' as const,
        data: {},
        visible: true,
      };

      const marker = manager.addMarkerToPreview('non-existent', markerData);
      expect(marker).toBeNull();
    });
  });

  describe('getDesignPreview', () => {
    it('should return the correct preview', () => {
      const preview = manager.createDesignPreview({
        name: 'Test Preview',
        circuitId: 'circuit-123',
        markers: [],
        lighting: { intensity: 1, color: '#ffffff', shadows: true },
        interactions: { pinchToZoom: true, dragToMove: true, tapToSelect: true },
        overlays: { measurements: true, grid: false, annotations: true },
      });

      const retrieved = manager.getDesignPreview(preview.id);
      expect(retrieved).toEqual(preview);
    });

    it('should return undefined for non-existent preview', () => {
      const retrieved = manager.getDesignPreview('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllPreviews', () => {
    it('should return all created previews', () => {
      const preview1 = manager.createDesignPreview({
        name: 'Preview 1',
        circuitId: 'circuit-1',
        markers: [],
        lighting: { intensity: 1, color: '#ffffff', shadows: true },
        interactions: { pinchToZoom: true, dragToMove: true, tapToSelect: true },
        overlays: { measurements: true, grid: false, annotations: true },
      });

      const preview2 = manager.createDesignPreview({
        name: 'Preview 2',
        circuitId: 'circuit-2',
        markers: [],
        lighting: { intensity: 1, color: '#ffffff', shadows: true },
        interactions: { pinchToZoom: true, dragToMove: true, tapToSelect: true },
        overlays: { measurements: true, grid: false, annotations: true },
      });

      const allPreviews = manager.getAllPreviews();
      expect(allPreviews).toHaveLength(2);
      expect(allPreviews).toContain(preview1);
      expect(allPreviews).toContain(preview2);
    });
  });
});