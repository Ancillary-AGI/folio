import { describe, expect, it } from 'vitest'
import { complex, solveComplexSystem, solveRealSystem } from './numeric'

describe('simulation numeric core', () => {
  it('solves a real system that requires row pivoting', () => {
    expect(solveRealSystem([[0, 1], [1, 1]], [2, 3])).toEqual([1, 2])
  })

  it('solves a complex system that requires row pivoting', () => {
    const result = solveComplexSystem([
      [complex(0), complex(1)],
      [complex(1), complex(1)],
    ], [complex(2), complex(3)])

    expect(result?.[0].re).toBeCloseTo(1)
    expect(result?.[0].im).toBeCloseTo(0)
    expect(result?.[1].re).toBeCloseTo(2)
    expect(result?.[1].im).toBeCloseTo(0)
  })

  it('returns null for singular real and complex systems', () => {
    expect(solveRealSystem([[1, 2], [2, 4]], [3, 6])).toBeNull()
    expect(solveComplexSystem([
      [complex(1), complex(2)],
      [complex(2), complex(4)],
    ], [complex(3), complex(6)])).toBeNull()
  })
})