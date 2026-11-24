/**
 * Camera-framing regressions for the 3D viewports.
 *
 * The old distance floored the model extent at 250 mm, so a 70 mm enclosure
 * was framed as if it were a quarter metre wide and read as a speck on a
 * mostly empty 2 m grid. The top preset also used +Y up while looking along
 * -Y, which is degenerate and rolled a rectangular tray to 45°.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIEW_DIRECTIONS, VIEW_UPS, fitFrameDistance, framingDistance, unionFrames, updateClipPlanes, type Framing } from './framing';

function camera(aspect = 16 / 9): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(45, aspect, 0.05, 500);
  result.updateProjectionMatrix();
  return result;
}

describe('framingDistance', () => {
  it('frames a millimetre-scale enclosure at its real size', () => {
    const distance = framingDistance(camera(), new THREE.Vector3(0.07, 0.012, 0.063));
    expect(distance).toBeGreaterThan(0.09);
    expect(distance).toBeLessThan(0.13);
  });

  it('frames a metre-scale beam without moving the camera farther away', () => {
    const distance = framingDistance(camera(), new THREE.Vector3(2, 0.1, 0.1));
    expect(distance).toBeGreaterThan(3);
    expect(distance).toBeLessThan(3.3);
  });

  it('backs off for a narrow viewport', () => {
    const wide = framingDistance(camera(16 / 9), new THREE.Vector3(2, 0.1, 0.1));
    const narrow = framingDistance(camera(0.5), new THREE.Vector3(2, 0.1, 0.1));
    expect(narrow).toBeGreaterThan(wide);
  });

  it('returns a finite positive distance for degenerate geometry', () => {
    const distance = framingDistance(camera(), new THREE.Vector3(0, 0, 0));
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
  });
});

describe('view presets', () => {
  it('uses a non-degenerate up vector for the top view', () => {
    expect(VIEW_DIRECTIONS.top.clone().normalize().dot(VIEW_UPS.top)).toBeCloseTo(0, 6);
    expect(VIEW_UPS.top.equals(new THREE.Vector3(0, 0, -1))).toBe(true);
  });

  it('keeps Y up for every non-top preset', () => {
    for (const mode of ['iso', 'front', 'side'] as const) {
      expect(VIEW_UPS[mode].equals(new THREE.Vector3(0, 1, 0))).toBe(true);
      expect(VIEW_DIRECTIONS[mode].length()).toBeCloseTo(1, 6);
      expect(Math.abs(VIEW_DIRECTIONS[mode].clone().normalize().dot(VIEW_UPS[mode]))).toBeLessThan(0.999);
    }
  });

  it('renders the top view axis-aligned on screen', () => {
    const view = camera();
    view.up.copy(VIEW_UPS.top);
    view.position.set(0, 10, 0);
    view.lookAt(0, 0, 0);
    view.updateMatrixWorld();
    const screenRight = new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 0);
    const screenUp = new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 1);
    expect(screenRight.x).toBeCloseTo(1, 6);
    expect(screenUp.z).toBeCloseTo(-1, 6);
  });
});

describe('updateClipPlanes', () => {
  it('scales near and far with the framed distance', () => {
    const view = camera();
    updateClipPlanes(view, 0.11);
    expect(view.near).toBeCloseTo(0.0011, 5);
    expect(view.far).toBeCloseTo(11, 5);
  });

  it('keeps a metre-scale view inside the clip range', () => {
    const view = camera();
    updateClipPlanes(view, 3.14);
    expect(view.near).toBeLessThan(0.05);
    expect(view.far).toBeGreaterThan(300);
  });
});

/**
 * Fitting a framed box to a viewport with an orbiting camera — the PCB preview's
 * framing. The distance used to come from a bounding sphere and a quarter of
 * slack each way, which showed a 245 mm mainboard as a postage stamp in a 16:9
 * viewport: the sphere fits the board to its diagonal, and the chrome the HUD
 * covers was charged against the width as well as the height.
 */
describe('fitFrameDistance', () => {
  const FOV_DEG = 42
  const WIDE = { width: 1600, height: 900 }
  const lookingDown = new THREE.Vector3(0, 1, 0)
  const tanHalfFov = Math.tan((FOV_DEG / 2) * (Math.PI / 180))

  it('fits a wide, shallow board to its width rather than its diagonal', () => {
    const frame: Framing = { center: [0, 0, 0], half: [122.5, 0.8, 1] }
    const distance = fitFrameDistance(frame, lookingDown, WIDE, FOV_DEG)
    // Top view puts the board's X along the screen's width, so the width term
    // governs and the chrome costs nothing on a 1 mm-tall strip.
    expect(distance).toBeCloseTo((122.5 / (tanHalfFov * (1600 / 900))) * 1.08 + 1, 6)
    const boundingSphere = Math.hypot(122.5, 1) / tanHalfFov
    expect(distance).toBeLessThan(boundingSphere)
  })

  it('backs the camera off for a narrow viewport', () => {
    const frame: Framing = { center: [0, 0, 0], half: [122.5, 0.8, 1] }
    const wide = fitFrameDistance(frame, lookingDown, WIDE, FOV_DEG)
    const narrow = fitFrameDistance(frame, lookingDown, { width: 400, height: 900 }, FOV_DEG)
    expect(narrow).toBeGreaterThan(wide * 2)
  })

  it('charges the chrome the height term only, so a deep frame pays for it', () => {
    const frame: Framing = { center: [0, 0, 0], half: [1, 0.8, 122.5] }
    const distance = fitFrameDistance(frame, lookingDown, WIDE, FOV_DEG)
    // The 0.3 HUD fraction leaves 70% of the height for the scene.
    expect(distance).toBeCloseTo((122.5 / (tanHalfFov * 0.7)) * 1.08 + 1, 6)
    expect(distance).toBeGreaterThan(122.5 / tanHalfFov)
  })

  it('keeps a degenerate frame in front of the camera', () => {
    const frame: Framing = { center: [0, 0, 0], half: [0, 0, 0] }
    expect(fitFrameDistance(frame, lookingDown, WIDE, FOV_DEG)).toBe(5)
  })

  it('falls back to a usable aspect when the viewport has no height', () => {
    const frame: Framing = { center: [0, 0, 0], half: [122.5, 0.8, 1] }
    const distance = fitFrameDistance(frame, lookingDown, { width: 800, height: 0 }, FOV_DEG)
    expect(Number.isFinite(distance)).toBe(true)
    expect(distance).toBeCloseTo((122.5 / (tanHalfFov * 1.6)) * 1.08 + 1, 6)
  })
})

/**
 * The PCB preview unions the board frame with an imported enclosure, so a case
 * bigger than the board stays on screen instead of overflowing the viewport.
 */
describe('unionFrames', () => {
  it('grows the frame to an enclosure bigger than the board it surrounds', () => {
    const frame = unionFrames(
      { center: [0, 0, 0], half: [20, 1, 10] },
      { center: [0, 0, 0], half: [60, 10, 45] },
    );
    expect(frame.center).toEqual([0, 0, 0]);
    expect(frame.half).toEqual([60, 10, 45]);
  });

  it('never shrinks the frame below the circuit it was already showing', () => {
    const frame = unionFrames(
      { center: [10, 0, 0], half: [30, 2, 20] },
      { center: [0, 0, 0], half: [5, 5, 5] },
    );
    expect(frame.center).toEqual([10, 0, 0]);
    expect(frame.half).toEqual([30, 5, 20]);
  });

  it('keeps the offset of a frame that sits beside another', () => {
    const frame = unionFrames(
      { center: [0, 0, 0], half: [10, 10, 10] },
      { center: [50, 0, 0], half: [10, 10, 10] },
    );
    expect(frame.center).toEqual([25, 0, 0]);
    expect(frame.half).toEqual([35, 10, 10]);
  });
});
