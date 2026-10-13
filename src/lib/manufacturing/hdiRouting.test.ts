import { describe, expect, it } from 'vitest';
import { reconstructPath, routeGrid, validateViaSpan, STD_HDI_RULES, type HdiStackup } from './hdiRouting';

const stackup = (layers: string[]): HdiStackup => ({
  layers: layers.map((id) => ({ id, kind: 'signal' as const, thicknessMm: 0.2 })),
  microviaDrillMm: STD_HDI_RULES.microviaDrillMm,
  microviaPadMm: STD_HDI_RULES.microviaPadMm,
  microviaSpan: STD_HDI_RULES.microviaSpan,
});

describe('HDI routing discipline', () => {
  it('routes around a wall with the true shortest length', () => {
    // 5x3 grid, wall at x=2 except a gap at y=1.
    const blocked = [
      [false, false, true, false, false],
      [false, false, false, false, false],
      [false, false, true, false, false],
    ];
    const { path, lengthCells } = routeGrid(blocked, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(lengthCells).toBe(6);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 0 });
    for (const p of path) {
      expect(blocked[p.y][p.x]).toBe(false);
    }
    // Manhattan distance is 4; the detour costs exactly 2 extra cells.
    expect(lengthCells).toBe(4 + 2);
  });
  it('reconstructs a parent chain and refuses broken ones', () => {
    const parent = new Map([
      ['0,0', null],
      ['1,0', { x: 0, y: 0 }],
      ['1,1', { x: 1, y: 0 }],
    ]);
    expect(reconstructPath(parent, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    ]);
    expect(() => reconstructPath(parent, { x: 0, y: 0 }, { x: 9, y: 9 })).toThrow(/no routed path/);
  });
  it('enforces microvia span discipline', () => {
    const s = stackup(['L1', 'L2', 'L3', 'L4']);
    expect(() => validateViaSpan(s, 'L1', 'L2')).not.toThrow();
    expect(() => validateViaSpan(s, 'L1', 'L3')).toThrow(/spans 2 layers/);
    expect(() => validateViaSpan(s, 'L1', 'L1')).toThrow(/itself/);
    expect(() => validateViaSpan(s, 'L1', 'L9')).toThrow(/unknown layer/);
  });
  it('fails loud on blocked endpoints and walled targets', () => {
    const blocked = [[true, false], [false, false]];
    expect(() => routeGrid(blocked, { x: 0, y: 0 }, { x: 1, y: 1 })).toThrow(/start is blocked/);
    const walled = [
      [false, true, false],
      [true, true, true],
      [false, true, false],
    ];
    expect(() => routeGrid(walled, { x: 0, y: 0 }, { x: 2, y: 2 })).toThrow(/no routed path/);
  });
});
