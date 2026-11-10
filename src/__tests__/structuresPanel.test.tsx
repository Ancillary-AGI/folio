/**
 * Structures panel render coverage.
 *
 * WebGL cannot run in jsdom, so the fiber Canvas is stubbed at the module
 * boundary while the direct-stiffness solver behind every number below it runs
 * for real. These tests pin the panel's two promises: the drawing says what the
 * solver solved, and a frame the solver cannot hold is reported as the broken
 * model it is rather than answered with zeroes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import StructuresPanel from '../components/structures/StructuresPanel'
import { armLibraryItem, dropLibraryItem } from './helpers/libraryDrop'

const exportSpies = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../lib/exportUtils', () => exportSpies)
import { mechanicalCatalog, trussCatalog } from '../lib/library/catalog'
import { describeMemberForce, solveTruss, type TrussModel } from '../lib/structures/truss'
import { TRUSS_PRESETS, trussCounts } from '../lib/structures/trussPresets'
import type { LibraryItem } from '../lib/library/types'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { DEFAULT_SETTINGS } from '../lib/settings/registry'

vi.mock('@react-three/fiber', () => {
  const state = {
    camera: {
      position: { set: () => {}, copy: () => ({ addScaledVector: () => {} }), addScaledVector: () => {} },
      lookAt: () => {},
      updateProjectionMatrix: () => {},
    },
    controls: null,
    size: { width: 800, height: 600 },
  }
  return {
    // The lattice is three.js intrinsics with no DOM equivalent; the sheet and the
    // read-outs are the panel's control surface, so the Canvas renders empty.
    Canvas: React.forwardRef(() => <div data-testid="r3f-canvas" />),
    useFrame: () => {},
    useThree: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state),
  }
})

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Grid: () => null,
  GizmoHelper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GizmoViewport: () => null,
  Line: () => null,
}))

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ domainDesigns: {}, currentProject: null })
  useAppStore.setState({ settings: DEFAULT_SETTINGS })
  useAppStore.getState().setArmedLibraryItem(null)
  exportSpies.downloadFile.mockClear()
})

/** The card the library dock drops onto. */
function sheetCard(): HTMLElement {
  const card = screen.getByText('Lattice sheet').closest('.cad-dropzone')
  if (!card) throw new Error('the lattice sheet is not a drop zone')
  return card as HTMLElement
}

/** The joint's own circle: the group also holds the deflected-shape dot. */
function jointCircle(id: string): Element {
  const circles = document.querySelectorAll(`[data-node-id="${id}"] circle`)
  const joint = circles[circles.length - 1]
  if (!joint) throw new Error(`joint ${id} is not drawn`)
  return joint
}

function catalogRow(catalog: LibraryItem[], id: string): LibraryItem {
  const found = catalog.find((item) => item.id === id)
  if (!found) throw new Error(`catalog row ${id} is gone`)
  return found
}

const trussRow = (id: string): LibraryItem => catalogRow(trussCatalog(), id)

const presetModel = (id: string): TrussModel => {
  const preset = TRUSS_PRESETS.find((entry) => entry.id === id)
  if (!preset) throw new Error(`preset ${id} is gone`)
  return preset.model
}

/** The determinacy sentence under the sheet, verdict included. */
function determinacySentence(): string {
  const line = screen.getByText(/bars\s*\+\s*\d+\s+restraints/)
  return (line.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The sheet's own count of what is drawn, read from its accessible name. */
function sheetCounts(): string {
  return screen.getByTestId('truss-sheet').getAttribute('aria-label') ?? ''
}

describe('StructuresPanel default frame', () => {
  it('opens on the Pratt girder, solved, and calls it determinate', () => {
    render(<StructuresPanel onClose={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Structures' })).toBeInTheDocument()
    expect(sheetCounts()).toBe('Truss sheet, select tool. 14 joints, 25 bars.')
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()

    const pratt = presetModel('pratt-footbridge')
    const { joints, members, restraints } = trussCounts(pratt)
    expect(determinacySentence()).toBe(
      `${members} bars + ${restraints} restraints vs ${2 * joints} for ${joints} joints — determinate`,
    )

    // A determinate frame with its bearings in place closes on its own load.
    expect(screen.getByText('Reactions close')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    // Every bar gets a row: the table is the solved set, not a sample of it.
    expect(screen.getAllByRole('row')).toHaveLength(members + 1)
  })

  it('writes the force the solver reported onto the drawing, not a placeholder', () => {
    render(<StructuresPanel onClose={() => {}} />)

    const { result } = solveTruss(presetModel('pratt-footbridge'))
    const demand = result!.members['diag-0']
    const title = document.querySelector('[data-member-id="diag-0"] title')
    expect(title?.textContent).toBe(`diag-0 · t0 → b1 · ${describeMemberForce(demand)}`)
    // A Pratt's diagonals hang the deck in tension; the sheet has to say so too.
    expect(demand.force).toBeGreaterThan(0)
    expect(title?.textContent).toContain('tension')
  })

  it('puts the frame in space under the app-wide shading choice', () => {
    render(<StructuresPanel onClose={() => {}} />)

    const outline = screen.getByRole('button', { name: 'Outline' })
    fireEvent.click(outline)
    expect(outline).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'false')
    // The viewport reads the same preference the settings page writes.
    expect(useAppStore.getState().settings.shadingMode).toBe('outline')

    fireEvent.click(screen.getByRole('button', { name: 'Solid' }))
    expect(useAppStore.getState().settings.shadingMode).toBe('solid')
  })
})

describe('StructuresPanel inspector', () => {
  it('selects a bar from the results table and reports its own solved numbers', () => {
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByText('bottom-2'))
    expect(screen.getByRole('heading', { name: 'Bar bottom-2' })).toBeInTheDocument()
    expect(screen.getByText('Axial force')).toBeInTheDocument()
    expect(screen.getByText('Slenderness')).toBeInTheDocument()
    // The bottom chord of a footbridge is in tension, and a tie cannot buckle —
    // the panel says that instead of printing a buckling number it does not have.
    const { result } = solveTruss(presetModel('pratt-footbridge'))
    expect(result!.members['bottom-2'].force).toBeGreaterThan(0)
    expect(screen.getByText('tension — cannot buckle')).toBeInTheDocument()
    expect(screen.getByText(/EN 10025 yield 355 MPa/)).toBeInTheDocument()
  })

  it('edits a joint by number and keeps the frame closing on its load', () => {
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.pointerDown(jointCircle('b1'))
    expect(screen.getByRole('heading', { name: 'Joint b1' })).toBeInTheDocument()
    expect(screen.getByLabelText('X position of b1')).toHaveValue(2)

    fireEvent.change(screen.getByLabelText('X position of b1'), { target: { value: '2.5' } })
    expect(screen.getByLabelText('X position of b1')).toHaveValue(2.5)

    // Loads are entered in kilonewtons, which is what a drafter thinks in.
    fireEvent.change(screen.getByLabelText('Vertical load at b1 in kilonewtons'), { target: { value: '-20' } })
    expect(screen.getByLabelText('Vertical load at b1 in kilonewtons')).toHaveValue(-20)
    expect(screen.getByText('Yes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Vertical load at b1 in kilonewtons')).toHaveValue(0)
    expect(useProjectStore.getState().domainDesigns.structures).toBeTruthy()
  })

  it('deletes a bar and tells the user the frame is now a mechanism', () => {
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByText('post-3'))
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(/mechanism/)
    expect(screen.getByText(/refuses to invent an answer/)).toBeInTheDocument()
    // The drawing is not thrown away with the answer: the geometry still stands.
    expect(document.querySelector('[data-member-id="bottom-2"]')).toBeInTheDocument()
    expect(determinacySentence()).toBe('24 bars + 3 restraints vs 28 for 14 joints — mechanism')
  })
})

describe('StructuresPanel sheet tools', () => {
  it('drags a joint to the grid and stops when the pointer is released', () => {
    render(<StructuresPanel onClose={() => {}} />)
    const svg = screen.getByTestId('truss-sheet')

    // A 12 m girder is drawn at metre bays, and the joint lands on one.
    fireEvent.pointerDown(jointCircle('b1'), { clientX: 168, clientY: 348 })
    fireEvent.pointerMove(svg, { clientX: 210, clientY: 348 })
    expect(screen.getByLabelText('X position of b1')).toHaveValue(3)

    fireEvent.pointerUp(svg, { clientX: 700, clientY: 100 })
    fireEvent.pointerMove(svg, { clientX: 700, clientY: 100 })
    expect(screen.getByLabelText('X position of b1')).toHaveValue(3)
  })

  it('draws a bar between two joints and calls the frame redundant', () => {
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bar' }))
    fireEvent.pointerDown(jointCircle('b0'))
    expect(screen.getByRole('status')).toHaveTextContent('Bar started at b0')

    fireEvent.pointerDown(jointCircle('b2'))
    expect(sheetCounts()).toBe('Truss sheet, bar tool. 14 joints, 26 bars.')
    expect(determinacySentence()).toBe('26 bars + 3 restraints vs 28 for 14 joints — redundant')
    // The gesture is over, so no half-drawn bar is left on screen.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // An indeterminate frame still has an answer: stiffness solves it, and the
    // panel says which way to read the count rather than refusing to run.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Reactions close')).toBeInTheDocument()
  })

  it('places a joint where the sheet is clicked and says it cannot hold the frame', () => {
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
    fireEvent.click(screen.getByTestId('truss-sheet'), { clientX: 500, clientY: 200 })

    expect(sheetCounts()).toBe('Truss sheet, joint tool. 15 joints, 25 bars.')
    expect(screen.getByRole('alert')).toHaveTextContent(/mechanism/)
    expect(screen.getByText(/Nothing solved yet/)).toBeInTheDocument()
    expect(jointCircle('joint-1')).toBeInTheDocument()
  })
})

describe('StructuresPanel library drops', () => {
  it('loads the standard frame a truss row names', () => {
    render(<StructuresPanel onClose={() => {}} />)

    dropLibraryItem(sheetCard(), trussRow('truss-warren-girder'))

    const warren = presetModel('warren-girder')
    const { joints, members, restraints } = trussCounts(warren)
    expect(determinacySentence()).toBe(
      `${members} bars + ${restraints} restraints vs ${2 * joints} for ${joints} joints — determinate`,
    )
    expect(sheetCounts()).toBe(`Truss sheet, select tool. ${joints} joints, ${members} bars.`)
    expect(screen.getByText('Reactions close')).toBeInTheDocument()
    // The Warren has no web verticals, so the old Pratt's chords are gone.
    expect(screen.queryByText('post-3')).not.toBeInTheDocument()
  })

  it('refuses a row that is not a frame, and says why', async () => {
    render(<StructuresPanel onClose={() => {}} />)
    const foreign = mechanicalCatalog()[0]

    dropLibraryItem(sheetCard(), foreign)

    const note = await screen.findByText(/is a mechanical solid — the truss sheet takes standard trusses\./)
    expect(note.textContent).toContain(foreign.name)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The refusal is the only news: the Pratt is still on the sheet.
    expect(sheetCounts()).toBe('Truss sheet, select tool. 14 joints, 25 bars.')
  })

  it('places an armed row from the keyboard-reachable button and spends it', () => {
    render(<StructuresPanel onClose={() => {}} />)

    act(() => {
      armLibraryItem(trussRow('truss-canopy-bracket'))
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Armed Canopy bracket — drop it on the sheet or place it here.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Place' }))
    const canopy = presetModel('canopy-bracket')
    const { joints, members, restraints } = trussCounts(canopy)
    expect(determinacySentence()).toBe(
      `${members} bars + ${restraints} restraints vs ${2 * joints} for ${joints} joints — determinate`,
    )
    // A spent row leaves no armed note behind.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(useAppStore.getState().armedLibraryItem).toBeNull()
  })

  it('loads the Warren frame the gallery demo asks for, exactly once', () => {
    useAppStore.getState().requestDemo('structures-warren')
    render(<StructuresPanel onClose={() => {}} />)

    const warren = presetModel('warren-girder')
    const { joints, members } = trussCounts(warren)
    expect(sheetCounts()).toBe(`Truss sheet, select tool. ${joints} joints, ${members} bars.`)
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('closes the workspace on request', () => {
    const onClose = vi.fn()
    render(<StructuresPanel onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close structures workspace' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('StructuresPanel framing sheet export', () => {
  /** A project with a name of its own, so a sheet can be titled by it. */
  const openProject = (): void => {
    useProjectStore.setState({
      currentProject: {
        id: 'project-1',
        user_id: 'user-1',
        name: 'Footbridge study',
        created_at: '2026-11-02',
        updated_at: '2026-11-02',
      },
    })
  }

  it('downloads the solved frame as an A3 sheet named for the preset it is', () => {
    // The sheet follows the drawing-paper preference (default A4), so the test
    // chooses A3 and the export has to obey it.
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, drawingPaperSize: 'A3' } })
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download drawing' }))
    expect(exportSpies.downloadFile).toHaveBeenCalledTimes(1)
    const [svg, filename, mime] = exportSpies.downloadFile.mock.calls[0]
    expect(filename).toBe('pratt_footbridge_girder_framing.svg')
    expect(mime).toBe('image/svg+xml')

    // The downloaded sheet is the real drawing: standard-scale A3 paper, the bar
    // count in the block, and the force the solver reported for a web diagonal.
    expect(svg).toContain('width="420mm" height="297mm"')
    expect(svg).toContain('>Pratt footbridge girder — truss framing drawing</title>')
    expect(svg).toContain('>25</text>')
    const { result } = solveTruss(presetModel('pratt-footbridge'))
    expect(svg).toContain(`>${(result!.members['diag-0'].force / 1e3).toFixed(2)}</text>`)

    expect(screen.getByLabelText('Drawing export status')).toHaveTextContent(
      'pratt_footbridge_girder_framing.svg — 25 bars scheduled, forces from the current solution.',
    )
  })

  it('exports the geometry of a frame the solver refuses, stamped NOT ANALYSED', () => {
    openProject()
    render(<StructuresPanel onClose={() => {}} />)

    fireEvent.click(screen.getByText('post-3'))
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Download drawing' }))

    expect(exportSpies.downloadFile).toHaveBeenCalledTimes(1)
    const [svg, filename] = exportSpies.downloadFile.mock.calls[0]
    // A mechanism is still a frame someone has to go and fix, so the geometry
    // ships — with the title block reporting 24 bars and every force an em dash.
    expect(svg).toContain('NOT ANALYSED')
    expect(svg).toContain('>24</text>')
    expect(svg).toContain('>—</text>')
    expect(filename).toBe('footbridge_study_framing.svg')
    expect(screen.getByLabelText('Drawing export status')).toHaveTextContent(
      /geometry only: the sheet is stamped NOT ANALYSED/,
    )
  })

  it('titles a hand-edited frame for the open project, not for the preset it came from', () => {
    openProject()
    render(<StructuresPanel onClose={() => {}} />)

    // The sheet opens on the Pratt, so its first export carries the preset's name.
    fireEvent.click(screen.getByRole('button', { name: 'Download drawing' }))
    expect(exportSpies.downloadFile.mock.calls[0][1]).toBe('pratt_footbridge_girder_framing.svg')

    fireEvent.pointerDown(jointCircle('b1'))
    fireEvent.change(screen.getByLabelText('X position of b1'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download drawing' }))

    const [svg, filename] = exportSpies.downloadFile.mock.calls[1]
    // Half an edited Pratt is nobody's standard product, so the sheet falls back
    // to the project it was drawn in.
    expect(filename).toBe('footbridge_study_framing.svg')
    expect(svg).toContain('>Footbridge study — truss framing drawing</title>')
    expect(screen.getByLabelText('Drawing export status')).toHaveTextContent('footbridge_study_framing.svg')
  })

  it('reports the failure instead of pretending a sheet was saved', () => {
    render(<StructuresPanel onClose={() => {}} />)

    exportSpies.downloadFile.mockImplementationOnce(() => {
      throw new Error('the browser refused the download')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download drawing' }))

    // The status line is the only news, and it is the error — not a success note
    // that happens to name a file nobody received.
    expect(screen.getByLabelText('Drawing export status')).toHaveTextContent(
      'the browser refused the download',
    )
  })
})
