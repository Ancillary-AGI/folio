import { describe, expect, it } from 'vitest'
import {
  closedness,
  pointsBounds,
  resampleStroke,
  simplifyStroke,
  straightness,
  strokesDistance,
  strokeLength,
  type Point,
} from './geometry'
import { dilate, maskIoU, rasterizeStrokes } from './raster'
import { recognizeSketch } from './recognize'
import {
  fitStrokesToBox,
  inkMask,
  otsuThreshold,
  skeletonize,
  traceImageToStrokes,
  type ImageDataLike,
} from './imageTrace'

const jitter = (points: Point[], amount = 0, seed = 7): Point[] => {
  let state = seed
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648 - 0.5
  }
  return points.map((point) => ({ x: point.x + random() * amount, y: point.y + random() * amount }))
}

const rotate = (points: Point[], degrees: number, origin: Point = { x: 0, y: 0 }): Point[] => {
  const radians = (degrees * Math.PI) / 180
  return points.map((point) => ({
    x: origin.x + (point.x - origin.x) * Math.cos(radians) - (point.y - origin.y) * Math.sin(radians),
    y: origin.y + (point.x - origin.x) * Math.sin(radians) + (point.y - origin.y) * Math.cos(radians),
  }))
}

const translate = (points: Point[], dx: number, dy: number): Point[] =>
  points.map((point) => ({ x: point.x + dx, y: point.y + dy }))

const circle = (cx: number, cy: number, r: number, steps = 28): Point[] => {
  const output: Point[] = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    output.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  }
  return output
}

const resistorShape: Point[] = [
  { x: 0, y: 15 },
  { x: 15, y: 15 },
  { x: 20, y: 5 },
  { x: 30, y: 25 },
  { x: 40, y: 5 },
  { x: 50, y: 25 },
  { x: 60, y: 5 },
  { x: 65, y: 15 },
  { x: 80, y: 15 },
]

const capacitorStrokes: Point[][] = [
  [
    { x: 0, y: 20 },
    { x: 25, y: 20 },
  ],
  [
    { x: 25, y: 5 },
    { x: 25, y: 35 },
  ],
  [
    { x: 35, y: 5 },
    { x: 35, y: 35 },
  ],
  [
    { x: 35, y: 20 },
    { x: 60, y: 20 },
  ],
]

const diodeStrokes: Point[][] = [
  [
    { x: 0, y: 20 },
    { x: 25, y: 20 },
  ],
  [
    { x: 25, y: 5 },
    { x: 25, y: 35 },
    { x: 45, y: 20 },
    { x: 25, y: 5 },
  ],
  [
    { x: 45, y: 5 },
    { x: 45, y: 35 },
  ],
  [
    { x: 45, y: 20 },
    { x: 60, y: 20 },
  ],
]

const groundStrokes: Point[][] = [
  [
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ],
  [
    { x: 5, y: 10 },
    { x: 35, y: 10 },
  ],
  [
    { x: 10, y: 15 },
    { x: 30, y: 15 },
  ],
  [
    { x: 13, y: 20 },
    { x: 27, y: 20 },
  ],
]

describe('stroke geometry', () => {
  it('resamples by arc length while keeping both ends', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0 },
    ]
    const sampled = resampleStroke(points, 10)
    expect(sampled[0]).toEqual({ x: 0, y: 0 })
    expect(sampled[sampled.length - 1]).toEqual({ x: 50, y: 0 })
    expect(sampled.length).toBeGreaterThan(4)
    for (let i = 1; i < sampled.length; i += 1) {
      expect(sampled[i].x - sampled[i - 1].x).toBeCloseTo(10, 5)
    }
  })

  it('drops collinear points but keeps real corners', () => {
    const simplified = simplifyStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
      ],
      0.5,
    )
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
    ])
  })

  it('reports straightness and closure without dividing by zero', () => {
    expect(straightness([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeCloseTo(1, 6)
    const loop = circle(0, 0, 10, 24)
    expect(closedness(loop)).toBeLessThan(0.1)
    expect(straightness([{ x: 4, y: 4 }])).toBe(0)
    expect(strokeLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5)
  })

  it('treats crossing strokes as touching', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    const b = [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]
    expect(strokesDistance(a, b)).toBe(0)
    const far = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
    ]
    expect(strokesDistance(a, far)).toBeGreaterThan(100)
  })
})

describe('raster comparison', () => {
  it('scores identical ink as a perfect match and dilation grows coverage', () => {
    const strokes = [resistorShape]
    const a = rasterizeStrokes(strokes).mask
    const b = rasterizeStrokes(strokes).mask
    expect(maskIoU(a, b)).toBe(1)
    const grown = dilate(a, 64, 2)
    let before = 0
    let after = 0
    for (let i = 0; i < a.length; i += 1) {
      before += a[i] ? 1 : 0
      after += grown[i] ? 1 : 0
    }
    expect(after).toBeGreaterThan(before)
  })
})

describe('freehand symbol recognition', () => {
  it('names each supported symbol from its shape', () => {
    const samples: Array<{ name: string; strokes: Point[][]; expected: string }> = [
      { name: 'resistor', strokes: [resistorShape], expected: 'resistor' },
      { name: 'capacitor', strokes: capacitorStrokes, expected: 'capacitor' },
      { name: 'diode', strokes: diodeStrokes, expected: 'diode' },
      { name: 'ground', strokes: groundStrokes, expected: 'ground' },
    ]
    for (const sample of samples) {
      const result = recognizeSketch(sample.strokes.map((points) => ({ points: jitter(points, 1.2, sample.name.length) })))
      expect(result.symbols.map((symbol) => symbol.templateId)).toContain(sample.expected)
      expect(result.symbols[0].confidence).toBeGreaterThan(0.7)
    }
  })

  it('reads a symbol drawn at a quarter turn and stores the rotation for placement', () => {
    const rotated = capacitorStrokes.map((points) => rotate(points, 90, { x: 30, y: 20 }))
    const result = recognizeSketch(rotated.map((points) => ({ points })))
    expect(result.symbols).toHaveLength(1)
    expect(result.symbols[0].templateId).toBe('capacitor')
    expect(result.symbols[0].rotation).toBe(90)
  })

  it('separates two parts joined by a drawn wire, and keeps the wire', () => {
    const wire = [
      { x: 80, y: 15 },
      { x: 150, y: 15 },
      { x: 200, y: 15 },
      { x: 200, y: 20 },
      { x: 260, y: 20 },
    ]
    const strokes = [
      { points: jitter(translate(resistorShape, 0, 0), 1, 3) },
      { points: jitter(translate(wire, 0, 0), 0.8, 4) },
      { points: jitter(translate(capacitorStrokes[0], 260, 0), 0.8, 5) },
      { points: translate(capacitorStrokes[1], 260, 0) },
      { points: translate(capacitorStrokes[2], 260, 0) },
      { points: translate(capacitorStrokes[3], 260, 0) },
    ]
    const result = recognizeSketch(strokes)
    const names = result.symbols.map((symbol) => symbol.templateId).sort()
    expect(names).toEqual(['capacitor', 'resistor'])
    expect(result.wires.length).toBeGreaterThanOrEqual(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('joins pen-lift segments into one wire', () => {
    const result = recognizeSketch([
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { points: [{ x: 101, y: 0 }, { x: 101, y: 80 }] },
    ])
    expect(result.symbols).toHaveLength(0)
    expect(result.wires).toHaveLength(1)
    expect(result.wires[0].points.length).toBe(3)
  })

  it('reports a scribble instead of inventing a part', () => {
    const scribble = [
      { x: 0, y: 0 },
      { x: 12, y: 25 },
      { x: 22, y: -8 },
      { x: 38, y: 30 },
      { x: 48, y: -12 },
      { x: 58, y: 22 },
      { x: 70, y: -20 },
      { x: 82, y: 26 },
      { x: 95, y: 2 },
    ]
    const result = recognizeSketch([{ points: scribble }])
    expect(result.symbols).toHaveLength(0)
    expect(result.rejected.length).toBeGreaterThan(0)
  })

  it('reports a closed rectangle as unsupported ink, not a wire', () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 70 },
      { x: 0, y: 70 },
      { x: 0, y: 0 },
    ]
    const result = recognizeSketch([{ points: rectangle }])
    expect(result.wires).toHaveLength(0)
    expect(result.rejected.some((entry) => entry.reason === 'closed-loop')).toBe(true)
  })

  it('recognises a junction dot next to a wire', () => {
    const dot = circle(200, 100, 4, 12).map((point) => ({ ...point }))
    const wire = [
      { x: 0, y: 100 },
      { x: 150, y: 100 },
    ]
    const result = recognizeSketch([{ points: wire }, { points: dot }])
    expect(result.junctions).toHaveLength(1)
    expect(result.junctions[0].center.x).toBeCloseTo(200, 0)
    expect(result.wires.length).toBe(1)
  })
})

describe('image tracing', () => {
  const makeImage = (width: number, height: number): ImageDataLike => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = 255
      data[i * 4 + 1] = 255
      data[i * 4 + 2] = 255
      data[i * 4 + 3] = 255
    }
    return { width, height, data }
  }

  const drawLine = (image: ImageDataLike, a: Point, b: Point) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2)
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const x = Math.round(a.x + (b.x - a.x) * t)
      const y = Math.round(a.y + (b.y - a.y) * t)
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset] = 0
      image.data[offset + 1] = 0
      image.data[offset + 2] = 0
    }
  }

  it('finds the ink cut for a bimodal image', () => {
    const values: number[] = []
    for (let i = 0; i < 500; i += 1) values.push(20)
    for (let i = 0; i < 500; i += 1) values.push(240)
    const threshold = otsuThreshold(values)
    expect(threshold).toBeGreaterThanOrEqual(20)
    expect(threshold).toBeLessThan(240)
    const mask = inkMask(makeImage(10, 10), { threshold: 128 }).mask
    expect(mask.every((value) => value === 0)).toBe(true)
  })

  it('thins a thick stroke to a one-pixel skeleton', () => {
    const mask = new Uint8Array(9 * 9)
    for (let y = 2; y <= 6; y += 1) for (let x = 2; x <= 6; x += 1) mask[y * 9 + x] = 1
    const skeleton = skeletonize(mask, 9, 9)
    const remaining = skeleton.reduce((total, value) => total + (value ? 1 : 0), 0)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(25)
  })

  it('traces line art into a resistor the recogniser can name', () => {
    const image = makeImage(240, 120)
    const placed = translate(resistorShape, 60, 40)
    for (let i = 1; i < placed.length; i += 1) drawLine(image, placed[i - 1], placed[i])
    const traced = traceImageToStrokes(image)
    expect(traced.strokes.length).toBeGreaterThan(0)
    const result = recognizeSketch(traced.strokes.map((points) => ({ points })))
    expect(result.symbols[0]?.templateId).toBe('resistor')
  })

  it('places traced ink on the sheet at a fixed span, keeping its aspect ratio', () => {
    const strokes = [
      [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    ]
    const [placed] = fitStrokesToBox(strokes, { width: 200, height: 100 }, { center: { x: 500, y: 300 }, span: 400 })
    expect(placed[0]).toEqual({ x: 300, y: 200 })
    expect(placed[1]).toEqual({ x: 700, y: 400 })
  })

  it('returns no ink for a blank page', () => {
    const traced = traceImageToStrokes(makeImage(80, 60))
    expect(traced.strokes).toHaveLength(0)
    expect(traced.inkRatio).toBe(0)
  })

  it('refuses a page that is almost entirely ink', () => {
    const image = makeImage(20, 20)
    for (let i = 0; i < 20 * 20; i += 1) {
      image.data[i * 4] = 0
      image.data[i * 4 + 1] = 0
      image.data[i * 4 + 2] = 0
    }
    const traced = traceImageToStrokes(image)
    expect(traced.strokes).toHaveLength(0)
    expect(traced.inkRatio).toBeGreaterThan(0.65)
  })
})

describe('recognition reporting', () => {
  it('reports the ink bounds and an empty drawing honestly', () => {
    const empty = recognizeSketch([])
    expect(empty.empty).toBe(true)
    expect(pointsBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })

    const result = recognizeSketch([{ points: resistorShape }])
    expect(result.inkBounds.width).toBeCloseTo(80, 5)
    expect(result.empty).toBe(false)
  })
})
