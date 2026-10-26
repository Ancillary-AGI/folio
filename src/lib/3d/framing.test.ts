/**
 * Camera-framing regressions for the mechanical viewport.
 *
 * The old distance floored the model extent at 250 mm, so a 70 mm enclosure
 * was framed as if it were a quarter metre wide and read as a speck on a
 * mostly empty 2 m grid. The top preset also used +Y up while looking along
 * -Y, which is degenerate and rolled a rectangular tray to 45°.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIEW_DIRECTIONS, VIEW_UPS, framingDistance, updateClipPlanes } from './framing';

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
