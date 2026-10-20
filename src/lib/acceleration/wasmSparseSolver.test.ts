import { describe, expect, it } from 'vitest';
import {
  denseToCsc,
  solveLinearSystemLu,
} from './wasmSparseSolver';

describe('Sparse Matrix LU Solver for SPICE', () => {
  it('converts dense circuit matrix into Compressed Sparse Column (CSC) format', () => {
    // 3x3 matrix with zeros:
    // [ 2,  0, -1 ]
    // [ 0,  3,  0 ]
    // [-1,  0,  4 ]
    const dense = [
      [2, 0, -1],
      [0, 3, 0],
      [-1, 0, 4],
    ];

    const csc = denseToCsc(dense);
    expect(csc.n).toBe(3);
    expect(csc.values.length).toBe(5); // 5 non-zero entries
    expect(csc.colPtr.length).toBe(4);
    expect(csc.colPtr[0]).toBe(0);
    expect(csc.colPtr[3]).toBe(5);
  });

  it('solves a linear MNA nodal circuit system with exact numerical precision', () => {
    // Solve:
    //  3*x0 - 1*x1 = 9
    // -1*x0 + 2*x1 = 2
    // Matrix:
    // [  3, -1 ] [x0] = [ 9 ]
    // [ -1,  2 ] [x1]   [ 2 ]
    // Exact solution: 3*4 - 3 = 9, -4 + 2*3 = 2 -> x0 = 4, x1 = 3
    const a = [
      [3, -1],
      [-1, 2],
    ];
    const b = [9, 2];

    const x = solveLinearSystemLu(a, b);
    expect(x[0]).toBeCloseTo(4.0, 6);
    expect(x[1]).toBeCloseTo(3.0, 6);
  });

  it('throws an error for singular circuits with ungrounded floating nodes', () => {
    // Singular matrix (row 1 is identical to row 0)
    const singular = [
      [1, 2],
      [1, 2],
    ];
    expect(() => solveLinearSystemLu(singular, [1, 1])).toThrow(/Singular matrix/);
  });
});
