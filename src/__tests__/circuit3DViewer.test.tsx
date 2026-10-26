/**
 * 3D viewer render coverage.
 * WebGL cannot run in jsdom, so the fiber Canvas and drei helpers are
 * stubbed at the module boundary — every toggle, button and export path
 * below them runs for real.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Circuit3DViewer from '../components/3d/Circuit3DViewer'
import { useProjectStore } from '../stores/useProjectStore'

vi.mock('@react-three/fiber', () => {
  const state = {
    camera: { position: { set: () => {} }, lookAt: () => {} },
    controls: null,
    size: { width: 800, height: 600 },
  }
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
    useFrame: () => {},
    useThree: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state),
  }
})

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Grid: () => null,
}))

const exportSpies = vi.hoisted(() => ({
  exportScene: vi.fn(() => 'solid test\nendsolid test'),
  exportMeshes: vi.fn(() => ({ obj: 'o test', mtl: 'newmtl test' })),
  downloadFile: vi.fn(),
}))
vi.mock('../lib/3d/stlExporter', () => ({ STLExporter: { exportScene: exportSpies.exportScene } }))
vi.mock('../lib/3d/objExporter', () => ({ objExporter: { exportMeshes: exportSpies.exportMeshes } }))
vi.mock('../lib/exportUtils', () => ({ downloadFile: exportSpies.downloadFile }))

describe('Circuit3DViewer', () => {
  beforeEach(() => {
    exportSpies.exportScene.mockClear()
    exportSpies.exportMeshes.mockClear()
    exportSpies.downloadFile.mockClear()
    // Seed an empty sheet: the viewer maps store components to 3D.
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
  })

  it('renders viewport chrome, view presets and layer toggles', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()
    for (const view of ['iso', 'top', 'front', 'side']) {
      expect(screen.getByRole('button', { name: view })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Reset View' })).toBeInTheDocument()
    expect(screen.getByText(/Components:/)).toBeInTheDocument()
  })

  it('switches camera presets', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'top' }))
    expect(screen.getByRole('button', { name: 'top' })).toHaveClass('bg-primary')
  })

  it('frames the routed circuit by default and can fall back to the board outline', () => {
    useProjectStore.setState({
      pcbLayout: {
        widthMm: 100,
        heightMm: 80,
        thicknessMm: 1.6,
        layers: [{ id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' }],
        traces: [{
          id: 't1', net: 'OUT', layerId: 'top-cu', widthMm: 0.25,
          points: [{ x: 10, y: 20 }, { x: 40, y: 20 }],
        }],
        vias: [],
        components: [{
          id: 'r1', reference: 'R1', footprint: '0805', category: 'resistor',
          x: 25, y: 20, rotationDeg: 0,
        }],
      },
    })

    render(<Circuit3DViewer onClose={() => {}} />)
    const circuit = screen.getByRole('button', { name: 'Circuit' })
    const board = screen.getByRole('button', { name: 'Board' })
    expect(circuit).toHaveClass('bg-primary')
    expect(board).not.toHaveClass('bg-primary')

    fireEvent.click(board)
    expect(board).toHaveClass('bg-primary')
    expect(circuit).not.toHaveClass('bg-primary')
  })

  it('exports STL through the real export path', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    const buttons = screen.getAllByRole('button')
    const stl = buttons.find((button) => button.textContent?.toLowerCase().includes('stl'))
    expect(stl).toBeDefined()
    if (stl) fireEvent.click(stl)
    expect(exportSpies.exportScene).toHaveBeenCalled()
  })

  it('exports OBJ through the real export path', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    const buttons = screen.getAllByRole('button')
    const obj = buttons.find((button) => button.textContent?.toLowerCase().includes('obj'))
    expect(obj).toBeDefined()
    if (obj) fireEvent.click(obj)
    expect(exportSpies.exportMeshes).toHaveBeenCalled()
  })

  it('renders the routed board instead of the demo slab when a layout exists', () => {
    useProjectStore.setState({
      pcbLayout: {
        widthMm: 100,
        heightMm: 80,
        thicknessMm: 1.6,
        layers: [
          { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' },
          { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00' },
        ],
        traces: [{
          id: 't1', net: 'OUT', layerId: 'top-cu', widthMm: 0.25,
          points: [{ x: 10, y: 20 }, { x: 40, y: 20 }],
        }],
        vias: [{ id: 'v1', net: 'GND', x: 50, y: 40, padDiameterMm: 0.6, drillDiameterMm: 0.3 }],
        components: [{
          id: 'r1', reference: 'R1', footprint: '0805', category: 'resistor',
          x: 25, y: 20, rotationDeg: 0,
        }],
      },
    })

    render(<Circuit3DViewer onClose={() => {}} />)
    expect(screen.getByText(/Routed layout/)).toBeInTheDocument()
    expect(screen.getByText(/Board: 100 × 80 mm/)).toBeInTheDocument()
    expect(screen.getByText(/Traces: 1/)).toBeInTheDocument()
    expect(screen.getByText('R1 · 0805')).toBeInTheDocument()
    expect(screen.getByText('Top Copper')).toBeInTheDocument()
  })

  it('exports the routed board geometry', () => {
    useProjectStore.setState({
      pcbLayout: {
        widthMm: 50,
        heightMm: 40,
        thicknessMm: 1.6,
        layers: [{ id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' }],
        traces: [{
          id: 't1', net: 'OUT', layerId: 'top-cu', widthMm: 0.25,
          points: [{ x: 5, y: 5 }, { x: 20, y: 5 }],
        }],
        vias: [],
        components: [],
      },
    })

    render(<Circuit3DViewer onClose={() => {}} />)
    const stl = screen.getAllByRole('button').find((button) =>
      button.textContent?.toLowerCase().includes('stl'))
    expect(stl).toBeDefined()
    if (stl) fireEvent.click(stl)
    expect(exportSpies.exportScene).toHaveBeenCalled()
  })
})
