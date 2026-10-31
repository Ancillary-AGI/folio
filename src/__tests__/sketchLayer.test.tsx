import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import SketchLayer from '../components/sketch/SketchLayer'
import { standardComponents } from '../lib/componentLibrary'
import type { Component } from '../lib/supabase'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useSketchStore } from '../stores/useSketchStore'

const library = standardComponents as Component[]

interface ScreenPoint {
  x: number
  y: number
}

const stubRect = (element: HTMLElement) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
  })
}

const draw = (surface: HTMLElement, points: ScreenPoint[], pointerType = 'pen') => {
  const first = points[0]
  fireEvent.pointerDown(surface, {
    pointerId: 7,
    pointerType,
    button: 0,
    clientX: first.x,
    clientY: first.y,
    pressure: 0.6,
  })
  for (const point of points.slice(1)) {
    fireEvent.pointerMove(surface, {
      pointerId: 7,
      pointerType,
      clientX: point.x,
      clientY: point.y,
      pressure: 0.6,
    })
  }
  const last = points[points.length - 1]
  fireEvent.pointerUp(surface, {
    pointerId: 7,
    pointerType,
    button: 0,
    clientX: last.x,
    clientY: last.y,
    pressure: 0.6,
  })
}

/** The resistor drawn the way the library draws it, offset onto the sheet. */
const resistorInk: ScreenPoint[] = [
  { x: 20, y: 35 },
  { x: 35, y: 35 },
  { x: 40, y: 25 },
  { x: 50, y: 45 },
  { x: 60, y: 25 },
  { x: 70, y: 45 },
  { x: 80, y: 25 },
  { x: 85, y: 35 },
  { x: 100, y: 35 },
]

const renderLayer = () => {
  const view = render(<SketchLayer library={library} />)
  const surface = screen.getByTestId('sketch-surface')
  stubRect(surface)
  return { ...view, surface }
}

describe('sketch layer', () => {
  beforeEach(() => {
    useSketchStore.setState({ strokes: [] })
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
    useAppStore.setState({
      activeTool: 'sketch',
      viewport: { zoom: 1, pan: { x: 0, y: 0 }, canvasSize: { width: 800, height: 600 } },
    })
  })

  it('captures a pen stroke in sheet coordinates and names the part', () => {
    const { surface } = renderLayer()
    draw(surface, resistorInk)

    const strokes = useSketchStore.getState().strokes
    expect(strokes).toHaveLength(1)
    expect(strokes[0].pointerType).toBe('pen')
    expect(strokes[0].points[0]).toEqual({ x: 20, y: 35 })

    expect(screen.getByText('Resistor')).toBeInTheDocument()
    expect(screen.getByText('parts 1')).toBeInTheDocument()
  })

  it('honours pan and zoom when converting the pointer to sheet space', () => {
    useAppStore.setState({ viewport: { zoom: 2, pan: { x: 100, y: 50 }, canvasSize: { width: 800, height: 600 } } })
    const { surface } = renderLayer()
    draw(surface, [
      { x: 140, y: 70 },
      { x: 180, y: 70 },
      { x: 220, y: 70 },
    ])

    expect(useSketchStore.getState().strokes[0].points[0]).toEqual({ x: 20, y: 10 })
    expect(useSketchStore.getState().strokes[0].points[2]).toEqual({ x: 60, y: 10 })
  })

  it('commits the recognised ink as a real part and clears the sheet of ink', () => {
    const { surface } = renderLayer()
    draw(surface, resistorInk)

    fireEvent.click(screen.getByRole('button', { name: 'Place on sheet' }))

    const project = useProjectStore.getState()
    expect(project.components).toHaveLength(1)
    expect(project.components[0].component.name).toBe('Resistor')
    expect(project.components[0].reference).toBe('R1')
    expect(project.components[0].rotation).toBe(0)
    expect(useSketchStore.getState().strokes).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('1 part and 0 wires placed.')
  })

  it('places the ink with the registered Ctrl+Enter shortcut', () => {
    const { surface } = renderLayer()
    draw(surface, resistorInk)

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(useProjectStore.getState().components).toHaveLength(1)
    expect(useSketchStore.getState().strokes).toHaveLength(0)
  })

  it('keeps the commit button disabled until there is ink to read', () => {
    renderLayer()
    expect(screen.getByRole('button', { name: 'Place on sheet' })).toBeDisabled()
  })

  it('ignores a tap and says why', () => {
    const { surface } = renderLayer()
    fireEvent.pointerDown(surface, { pointerId: 3, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(surface, { pointerId: 3, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 })

    expect(useSketchStore.getState().strokes).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('A single tap is not a line')
  })

  it('ignores a palm touch while the pen is in use', () => {
    const { surface } = renderLayer()
    draw(surface, resistorInk, 'pen')
    fireEvent.pointerDown(surface, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(surface, { pointerId: 9, pointerType: 'touch', clientX: 400, clientY: 300 })
    fireEvent.pointerUp(surface, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 400, clientY: 300 })

    expect(useSketchStore.getState().strokes).toHaveLength(1)
  })

  it('undoes and clears strokes without touching the design', () => {
    const { surface } = renderLayer()
    draw(surface, resistorInk)
    draw(surface, [
      { x: 200, y: 100 },
      { x: 260, y: 100 },
      { x: 320, y: 100 },
    ])
    expect(useSketchStore.getState().strokes).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Undo stroke' }))
    expect(useSketchStore.getState().strokes).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear ink' }))
    expect(useSketchStore.getState().strokes).toHaveLength(0)
    expect(useProjectStore.getState().components).toHaveLength(0)
  })

  it('zooms the sheet around the pointer while the layer owns input', () => {
    const { surface } = renderLayer()
    fireEvent.wheel(surface, { deltaY: -120, clientX: 400, clientY: 300 })

    const { zoom, pan } = useAppStore.getState().viewport
    expect(zoom).toBeGreaterThan(1)
    // The sheet point under (400, 300) stays under the pointer.
    expect(400 * zoom + pan.x).toBeCloseTo(400, 6)
  })
})
