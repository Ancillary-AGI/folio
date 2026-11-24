import { describe, expect, it } from 'vitest'
import {
  pointInRect,
  pointSegmentDistance,
  polylineCircleDistance,
  polylineDistance,
  polylineLength,
  polylineRectDistance,
  segmentDistance,
} from './distance'

describe('pointSegmentDistance', () => {
  it('projects onto the interior of a segment', () => {
    expect(pointSegmentDistance({ x: 1, y: 2 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(2)
  })

  it('clamps to the nearest endpoint', () => {
    expect(pointSegmentDistance({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(3)
    expect(pointSegmentDistance({ x: 7, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(3)
  })

  it('handles a degenerate segment', () => {
    expect(pointSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5)
  })
})

describe('segmentDistance', () => {
  it('returns zero for a proper crossing', () => {
    expect(segmentDistance({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })).toBe(0)
  })

  it('returns zero when an endpoint lands exactly on the other segment', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 })).toBe(0)
  })

  it('returns zero for collinear overlap', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 6, y: 0 })).toBe(0)
  })

  it('measures the gap between offset parallel segments', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 }, { x: 4, y: 2 })).toBeCloseTo(2)
  })

  it('measures endpoint-to-endpoint diagonal distance', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 4, y: 4 }, { x: 5, y: 4 })).toBeCloseTo(5)
  })
})

describe('polylineDistance', () => {
  it('treats single points as degenerate segments', () => {
    expect(polylineDistance([{ x: 0, y: 0 }], [{ x: 3, y: 4 }])).toBeCloseTo(5)
  })

  it('stops as soon as contact is found', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    const b = [{ x: 5, y: -5 }, { x: 5, y: 5 }]
    expect(polylineDistance(a, b)).toBe(0)
  })

  it('returns infinity when either polyline is empty', () => {
    expect(polylineDistance([], [{ x: 0, y: 0 }])).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('polylineLength', () => {
  it('sums segment lengths', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 8 }])).toBeCloseTo(9)
  })

  it('is zero for a single point', () => {
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0)
  })
})

describe('polylineRectDistance', () => {
  const rect = { center: { x: 0, y: 0 }, width: 4, height: 2 }

  it('detects a polyline crossing the rectangle', () => {
    expect(polylineRectDistance([{ x: -5, y: 0 }, { x: 5, y: 0 }], rect)).toBe(0)
  })

  it('detects a vertex inside the rectangle', () => {
    expect(polylineRectDistance([{ x: 1, y: 0.5 }, { x: 10, y: 10 }], rect)).toBe(0)
  })

  it('measures the exact gap from an edge', () => {
    expect(polylineRectDistance([{ x: -5, y: 3 }, { x: 5, y: 3 }], rect)).toBeCloseTo(2)
  })

  it('measures diagonal corner distance', () => {
    expect(polylineRectDistance([{ x: 4, y: 4 }], rect)).toBeCloseTo(Math.hypot(2, 3))
  })

  it('reports containment for points', () => {
    expect(pointInRect({ x: 1, y: 0 }, rect)).toBe(true)
    expect(pointInRect({ x: 3, y: 0 }, rect)).toBe(false)
  })
})

describe('polylineCircleDistance', () => {
  it('subtracts the radius from centre-line distance', () => {
    expect(polylineCircleDistance([{ x: 0, y: 5 }, { x: 2, y: 5 }], { x: 0, y: 0 }, 2)).toBeCloseTo(3)
  })

  it('is negative when the circle overlaps the polyline', () => {
    expect(polylineCircleDistance([{ x: 0, y: 1 }, { x: 4, y: 1 }], { x: 2, y: 0 }, 1.5)).toBeCloseTo(-0.5)
  })
})
