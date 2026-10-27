/**
 * SchematicToPcbPanel: the conversion has to leave something behind.
 *
 * Before this the panel kept the layout in local state, dropped it on error, and
 * printed "Nets: 0" for every live sheet. These tests pin the three properties
 * that make the panel usable: the board is published to the project store, the
 * routing verdict says what the router actually finished, and a failed
 * conversion is shown rather than logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SchematicToPcbPanel } from '../components/schematicToPcb/SchematicToPcbPanel'
import { schematicToPcbConverter } from '../lib/schematicToPcb/schematicToPcbConverter'
import { useProjectStore } from '../stores/useProjectStore'
import type { Schematic } from '../types'

const exportSpies = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../lib/exportUtils', () => exportSpies)

const resistor = {
  id: 'resistor',
  name: 'Resistor',
  category: 'passive',
  symbol: { width: 20, height: 10, paths: [] },
  pins: [
    { id: 'p1', name: '1', x: 0, y: 0, type: 'passive' as const },
    { id: 'p2', name: '2', x: 20, y: 0, type: 'passive' as const },
  ],
  properties: {},
};

const placed = (id: string, reference: string, x: number, y: number) => ({
  id,
  componentId: 'resistor',
  component: resistor,
  position: { x, y },
  rotation: 0,
  scale: 1,
  reference,
  properties: {},
});

const schematic: Schematic = {
  id: 'panel-circuit',
  name: 'Panel Circuit',
  components: [placed('r1', 'R1', 10, 10), placed('r2', 'R2', 40, 30)],
  wires: [{
    id: 'w1',
    points: [{ x: 10, y: 10 }, { x: 40, y: 30 }],
    netName: 'NET_A',
    connectedPins: [
      { componentId: 'r1', pinId: 'p1' },
      { componentId: 'r2', pinId: 'p1' },
    ],
  }],
  nets: [],
  metadata: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', version: '1.0.0' },
  settings: { gridSize: 10, snapToGrid: true, showGrid: true, showPinNumbers: true, showPinNames: true, showNetNames: true },
};

const convert = () => fireEvent.click(screen.getByRole('button', { name: 'Convert to PCB' }));

beforeEach(() => {
  exportSpies.downloadFile.mockClear();
  useProjectStore.setState({ pcbLayout: null });
});

describe('SchematicToPcbPanel', () => {
  it('publishes the converted board so the rest of the app can read it', async () => {
    render(<SchematicToPcbPanel schematic={schematic} />);

    convert();

    await waitFor(() => expect(useProjectStore.getState().pcbLayout).not.toBeNull());
    const scene = useProjectStore.getState().pcbLayout!;
    expect(scene.widthMm).toBe(100);
    expect(scene.components.map((component) => component.reference)).toEqual(['R1', 'R2']);
    expect(scene.traces.length).toBeGreaterThan(0);
    expect(screen.getByText('Netlist router finished 1/1 nets.')).toBeInTheDocument();
    expect(screen.getByText(/Published as the project board layout/)).toBeInTheDocument();
  });

  it('counts nets from the wires that carry connectivity', () => {
    render(<SchematicToPcbPanel schematic={schematic} />);

    expect(screen.getByText('Nets resolved from wires and declared nets: 1')).toBeInTheDocument();
  });

  it('exports the converted top copper as Gerber', async () => {
    render(<SchematicToPcbPanel schematic={schematic} />);

    convert();
    await waitFor(() => expect(screen.getByText(/Converted board/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Top-copper Gerber' }));

    expect(exportSpies.downloadFile).toHaveBeenCalledTimes(1);
    const [content, filename] = exportSpies.downloadFile.mock.calls[0];
    expect(content).toContain('%FSLAX46Y46*%');
    expect(filename).toContain('.gbr');
  });

  it('refuses an impossible board size instead of feeding NaN to the router', () => {
    render(<SchematicToPcbPanel schematic={schematic} />);

    fireEvent.change(screen.getByLabelText('Board Width (mm)'), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Convert to PCB' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Board Width (mm) must be a positive number.',
    );
    expect(useProjectStore.getState().pcbLayout).toBeNull();
  });

  it('shows a conversion that failed inside the engine', async () => {
    const failing = vi.spyOn(schematicToPcbConverter, 'convertSchematicToPCB')
      .mockRejectedValue(new Error('router gave up'));

    render(<SchematicToPcbPanel schematic={schematic} />);
    convert();

    await waitFor(() => expect(screen.getByText(/Conversion failed/)).toBeInTheDocument());
    expect(screen.getByText(/router gave up/)).toBeInTheDocument();
    expect(screen.getByText(/No board was published/)).toBeInTheDocument();
    expect(useProjectStore.getState().pcbLayout).toBeNull();
    failing.mockRestore();
  });
});
