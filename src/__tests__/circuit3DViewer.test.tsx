/**
 * 3D viewer render coverage.
 * WebGL cannot run in jsdom, so the fiber Canvas and drei helpers are
 * stubbed at the module boundary — every toggle, button and export path
 * below them runs for real.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as THREE from 'three'
import Circuit3DViewer from '../components/3d/Circuit3DViewer'
import { boxMeshObj } from '../lib/3d/meshFixtures'
import { useEnclosureStore } from '../stores/useEnclosureStore'
import { useProjectStore } from '../stores/useProjectStore'

/** What the fiber's camera and controls were told, captured through the mock. */
const rig = vi.hoisted(() => ({
  position: [0, 0, 0] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
}))

vi.mock('@react-three/fiber', () => {
  const state = {
    camera: {
      position: { set: (x: number, y: number, z: number) => { rig.position = [x, y, z] } },
      lookAt: () => {},
    },
    controls: {
      target: { set: (x: number, y: number, z: number) => { rig.target = [x, y, z] } },
      update: () => {},
    },
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
    useEnclosureStore.getState().setEnclosure(null)
    rig.position = [0, 0, 0]
    rig.target = [0, 0, 0]
  })

  it('renders viewport chrome, view presets and layer toggles', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()
    for (const view of ['iso', 'top', 'front', 'side']) {
      expect(screen.getByRole('button', { name: view })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Reset View' })).toBeInTheDocument()
    expect(screen.getByText('Parts')).toBeInTheDocument()
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
    expect(screen.getByTestId('hud-Board')).toHaveTextContent('100 × 80 mm')
    expect(screen.getByTestId('hud-Traces')).toHaveTextContent('1')
    expect(screen.getByText('R1 · 0805')).toBeInTheDocument()
    expect(screen.getByText('Top Copper')).toBeInTheDocument()
  })

  it('selects the soldermask colour and pad finish previewed on the board', () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    const black = screen.getByRole('button', { name: 'Matte black soldermask' })
    expect(black).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(black)
    expect(black).toHaveAttribute('aria-pressed', 'true')

    const finish = screen.getByLabelText('Pad finish')
    fireEvent.change(finish, { target: { value: 'hasl' } })
    expect(screen.getByText(/Bright silver alloy/)).toBeInTheDocument()
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

  /** Choose a shell in the file picker the way the Import button drives it. */
  function uploadShell(name: string, contents: string): void {
    const input = screen.getByLabelText('Choose an enclosure file to import')
    fireEvent.change(input, { target: { files: [new File([contents], name, { type: 'text/plain' })] } })
  }

  const routedLayout = () => useProjectStore.setState({
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
      vias: [],
      components: [{ id: 'r1', reference: 'R1', footprint: '0805', category: 'resistor', x: 25, y: 20 }],
    },
  })

  it('measures an imported enclosure against the routed board', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    expect(screen.getByText(/No shell imported/)).toBeInTheDocument()

    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    // 100 × 80 board inside a 120 × 90 cavity: 5 mm at the walls is the tightest.
    await waitFor(() => expect(screen.getByText(/Board fits/)).toBeInTheDocument())
    expect(screen.getByText(/5 mm left at the front wall/)).toBeInTheDocument()
    expect(screen.getByText('housing.obj')).toBeInTheDocument()
    expect(screen.getByText('120 mm × 90 mm × 20 mm')).toBeInTheDocument()
    // The stack is the laminate plus the body standing on it, not the bare board.
    expect(screen.getByText(/100 mm × 80 mm × 2\.\d+ mm/)).toBeInTheDocument()
    // Says what it does not see, instead of implying the case assembles.
    expect(screen.getByText(/ribs, bosses and cut-outs in the model are not measured/)).toBeInTheDocument()
    expect(screen.getByText(/Board fits/).className).toContain('text-success')
    expect(screen.queryByText(/a closed solid/)).not.toBeInTheDocument()
  })

  it('keeps an imported shell out of the exported board', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByText(/Board fits/)).toBeInTheDocument())

    const stl = screen.getAllByRole('button').find((button) =>
      button.textContent?.toLowerCase().includes('stl'))
    expect(stl).toBeDefined()
    if (stl) fireEvent.click(stl)
    expect(exportSpies.exportScene).toHaveBeenCalled()
    // The card says the case never reaches the fab export. Measure what was
    // actually handed to the exporter: the board, not the 120 mm cavity.
    const [exported] = exportSpies.exportScene.mock.calls[0] as unknown as [THREE.Scene]
    const bounds = new THREE.Box3().setFromObject(exported)
    const size = new THREE.Vector3()
    bounds.getSize(size)
    expect(size.x).toBeLessThan(120)
    expect(size.z).toBeLessThan(90)
    expect(Math.round(size.x)).toBe(100)
    expect(exported.children.map((object) => object.name)).toEqual(['pcb-layout'])
  })

  it('names the wall the board breaks through', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('too-narrow.obj', boxMeshObj(88, 90, 20))
    await waitFor(() => expect(screen.getByText(/Board does not fit/)).toBeInTheDocument())
    expect(screen.getByText(/6 mm past the left wall/)).toBeInTheDocument()
    expect(useEnclosureStore.getState().enclosure?.name).toBe('too-narrow.obj')
  })

  it('reports an open shell as open while still giving the envelope numbers', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('tray.stl', [
      'solid tray',
      'facet normal 0 1 0', 'outer loop',
      'vertex -60 0 -45', 'vertex 60 0 -45', 'vertex 60 0 45', 'endloop', 'endfacet',
      'facet normal 0 1 0', 'outer loop',
      'vertex -60 0 -45', 'vertex 60 0 45', 'vertex -60 0 45', 'endloop', 'endfacet',
      'endsolid tray',
    ].join('\n'))
    await waitFor(() => expect(screen.getByText(/Board does not fit/)).toBeInTheDocument())
    // The defect rides on the verdict itself, not in a footnote below the numbers.
    const line = screen.getByText(/Board does not fit/)
    expect(line.textContent).toMatch(/Not a closed solid: 4 open edges/)
    expect(line.textContent).toMatch(/not an assembly proof/)
    expect(line.className).toContain('text-warning')
  })

  it('refuses a shell named for the wrong reader instead of measuring nothing', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('actually-an-obj.stl', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/This is an OBJ file, not an STL/)
    expect(useEnclosureStore.getState().enclosure).toBeNull()
    expect(screen.getByText(/No shell imported/)).toBeInTheDocument()
  })

  it('draws the shell but refuses a fit verdict with no routed board', async () => {
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByText('housing.obj')).toBeInTheDocument())
    expect(screen.getByText(/The fit needs a routed board layout/)).toBeInTheDocument()
    expect(screen.queryByText(/Board fits/)).not.toBeInTheDocument()
  })

  it('drops the shell when the designer removes it', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByText(/Board fits/)).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Remove enclosure shell'))
    expect(useEnclosureStore.getState().enclosure).toBeNull()
    expect(screen.getByText(/No shell imported/)).toBeInTheDocument()
  })

  /** The orbit radius the camera was last given, measured against its own target. */
  function cameraDistance(): number {
    const [px, py, pz] = rig.position
    const [tx, ty, tz] = rig.target
    return Math.hypot(px - tx, py - ty, pz - tz)
  }

  /** Board-outline framing from straight above, so only the footprint sets the shot. */
  function frameBoardFromAbove(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    fireEvent.click(screen.getByRole('button', { name: 'top' }))
  }

  it('frames an imported case as if it were the board it holds', async () => {
    routedLayout()
    const first = render(<Circuit3DViewer onClose={() => {}} />)
    frameBoardFromAbove()
    const boardOnly = cameraDistance()

    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByText(/Board fits/)).toBeInTheDocument())
    const withCase = cameraDistance()
    expect(withCase).toBeGreaterThan(boardOnly)
    first.unmount()

    // The camera was pulled back to the 120 × 90 cavity, not to the 100 × 80
    // board inside it: a board cut to the case's own footprint is shot from the
    // same distance. The two frames differ only in height, which the top view
    // barely projects, so a half-millimetre tolerance is a tight comparison.
    useProjectStore.setState({
      pcbLayout: {
        widthMm: 120,
        heightMm: 90,
        thicknessMm: 1.6,
        layers: [{ id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' }],
        traces: [],
        vias: [],
        components: [],
      },
    })
    useEnclosureStore.getState().setEnclosure(null)
    render(<Circuit3DViewer onClose={() => {}} />)
    frameBoardFromAbove()
    expect(Math.abs(cameraDistance() - withCase)).toBeLessThan(0.05)
  })

  it('puts the camera back where it was when the case is hidden', async () => {
    routedLayout()
    render(<Circuit3DViewer onClose={() => {}} />)
    frameBoardFromAbove()
    const boardOnly = cameraDistance()

    uploadShell('housing.obj', boxMeshObj(120, 90, 20))
    await waitFor(() => expect(screen.getByText(/Board fits/)).toBeInTheDocument())
    expect(cameraDistance()).toBeGreaterThan(boardOnly)

    fireEvent.click(screen.getByLabelText('Hide enclosure shell'))
    expect(cameraDistance()).toBeCloseTo(boardOnly, 6)
  })
})
