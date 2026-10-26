import { beforeEach, describe, expect, it } from 'vitest';
import { AgentHarness } from './agentHarness';
import { planEdaFlow, planEdaRun, registerEdaTools } from './edaTools';
import type { Component } from '../supabase';
import { standardComponents } from '../componentLibrary';
import { buildDemoBoard } from '../demo/demoBoard';
import type { PcbSceneInput } from '../pcb/pcbScene';
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore';
import type { PcbSnapshot } from './pcbSnapshot';

const budget = () => ({ maxCalls: 20, maxWallMs: 60_000, startedAt: Date.now() });
const allow = () => true;

const librarySymbol = (name: string): Component => {
  const found = standardComponents.find((entry) => entry.name === name);
  if (!found) throw new Error(`component library is missing "${name}"`);
  return { ...found, id: `lib-${name}` } as Component;
};

/** Two real 0805 resistors with library pins and a stock footprint. */
const resistor = (reference: string, x: number, y: number): CanvasComponent => {
  const component = librarySymbol('Resistor');
  return {
    id: `id-${reference}`,
    componentId: component.id ?? 'lib-Resistor',
    component,
    x,
    y,
    rotation: 0,
    reference,
    properties: { value: '10k', footprint: '0805' },
  };
};

/** One electrical net joining the two left-hand pins. */
const hookup: CanvasWire = {
  id: 'w-a',
  netName: 'A',
  connectedPins: [
    { componentId: 'id-R1', pinId: 'p1' },
    { componentId: 'id-R2', pinId: 'p1' },
  ],
  points: [{ x: 20, y: 20 }, { x: 80, y: 20 }],
};

const sheet = () => ({
  components: [resistor('R1', 20, 20), resistor('R2', 80, 20)],
  wires: [hookup],
});

interface RouteResult {
  published: boolean;
  source: 'store' | 'payload';
  board: { widthMm: number; heightMm: number };
  components: number;
  traces: number;
  vias: number;
  unrouted: string[];
  completionRate: number;
}

interface DrcResult {
  source: 'routed-layout' | 'schematic';
  shippable: boolean;
  traces?: number;
  vias?: number;
  unroutedNets?: string[];
  splitNets?: Array<{ net: string; groups: number }>;
  violations: Array<{ type: string; severity: string; message: string }>;
  summary: { errors: number; warnings: number; totalViolations: number };
}

interface ExportResult {
  source: 'routed-layout' | 'schematic';
  project: string;
  shippable: boolean;
  refused: boolean;
  files: number;
  manifest: string[];
  centroid: number;
  bom: number;
}

interface ObserveResult {
  source: 'store' | 'payload';
  snapshot: PcbSnapshot;
  svg: string;
}

describe('EDA tools wired to real engines', () => {
  beforeEach(() => {
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null });
  });

  it('simulates a real voltage divider through the SPICE engine', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    expect(h.listTools()).toEqual(['eda.simulate', 'eda.route', 'eda.observe', 'eda.movePart', 'eda.addTrace', 'eda.addVia', 'eda.drc', 'eda.exportFab']);
    const b = budget();
    const netlist = {
      title: 'divider', components: [
        { type: 'voltage-source', name: 'V1', nodes: ['in', '0'], parameters: { dc: 5 } },
        { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { resistance: '10k' } },
        { type: 'resistor', name: 'R2', nodes: ['out', '0'], parameters: { resistance: '10k' } },
      ],
      analyses: [{ type: 'dc' as const }],
    };
    const call = await h.call('simulate', {}, b, () => true).catch(() => null);
    expect(call).toBeNull(); // unknown tool still refused
    const sim = await h.call('eda.simulate', { netlist: JSON.stringify(netlist) }, b, () => true);
    expect(sim.error).toBeUndefined();
    const result = sim.result as { success: boolean; operatingPoint?: Record<string, number> };
    expect(result.success).toBe(true);
    const midpoint = result.operatingPoint?.['OUT'] ?? result.operatingPoint?.['out'] ?? result.operatingPoint?.['Out'];
    expect(midpoint).toBeCloseTo(2.5, 2);
  });

  it('publishes the routed board so DRC and fab export consume the same copper', async () => {
    useProjectStore.setState(sheet());
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const routed = await h.call('eda.route', {}, b, allow);
    expect(routed.error).toBeUndefined();
    const route = routed.result as RouteResult;
    expect(route.published).toBe(true);
    expect(route.source).toBe('store');
    expect(route.components).toBe(2);
    expect(route.traces).toBeGreaterThan(0);
    expect(route.unrouted).toEqual([]);
    expect(route.completionRate).toBe(1);

    const layout = useProjectStore.getState().pcbLayout;
    expect(layout).not.toBeNull();
    expect(layout?.traces).toHaveLength(route.traces);
    expect(layout?.vias).toHaveLength(route.vias);
    expect(layout?.components.map((component) => component.reference).sort()).toEqual(['R1', 'R2']);
    for (const trace of layout?.traces ?? []) {
      for (const point of trace.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(layout?.widthMm ?? 0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(layout?.heightMm ?? 0);
      }
    }

    const drc = await h.call('eda.drc', { profile: 'JLCPCB_1oz' }, b, allow);
    expect(drc.error).toBeUndefined();
    const report = drc.result as DrcResult;
    expect(report.source).toBe('routed-layout');
    expect(report.traces).toBe(route.traces);
    expect(report.vias).toBe(route.vias);
    expect(report.unroutedNets).toEqual([]);
    expect(report.shippable).toBe(true);
    expect(report.violations).toEqual([]);

    const fab = await h.call('eda.exportFab', { project: 'demo', profile: 'JLCPCB_1oz' }, b, allow);
    expect(fab.error).toBeUndefined();
    const pkg = fab.result as ExportResult;
    expect(pkg.source).toBe('routed-layout');
    expect(pkg.project).toBe('demo');
    expect(pkg.shippable).toBe(true);
    expect(pkg.refused).toBe(false);
    expect(pkg.files).toBe(10);
    expect(pkg.manifest).toEqual(expect.arrayContaining([
      'demo-F_Cu.gtl', 'demo-B_Cu.gbl', 'demo-F_Mask.gts', 'demo-B_Mask.gbs',
      'demo-F_Silk.gto', 'demo-B_Silk.gbo', 'demo-Edge_Cuts.gm1', 'demo.drl',
      'demo-centroid.csv', 'demo-bom.csv',
    ]));
    expect(pkg.centroid).toBe(2);
    expect(pkg.bom).toBe(2);
  });

  it('routes and exports the built-in rectifier demo without treating Ground as a part', async () => {
    const demo = buildDemoBoard();
    useProjectStore.setState({ components: demo.components, wires: demo.wires, pcbLayout: null });
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const routed = await h.call('eda.route', {}, b, allow);
    expect(routed.error).toBeUndefined();
    const route = routed.result as RouteResult;
    expect(route.published).toBe(true);
    expect(route.components).toBe(5); // V1, RSRC, D1, C1, RLOAD — G1 is a net marker
    expect(route.completionRate).toBe(1);
    expect(route.unrouted).toEqual([]);
    expect(route.traces).toBeGreaterThan(0);

    const layout = useProjectStore.getState().pcbLayout;
    expect(layout?.components.map((component) => component.reference)).not.toContain('G1');

    const drc = await h.call('eda.drc', {}, b, allow);
    expect(drc.error).toBeUndefined();
    expect((drc.result as DrcResult).shippable).toBe(true);

    const fab = await h.call('eda.exportFab', { project: 'rectifier' }, b, allow);
    expect(fab.error).toBeUndefined();
    const pkg = fab.result as ExportResult;
    expect(pkg.shippable).toBe(true);
    expect(pkg.centroid).toBe(5);
    expect(pkg.bom).toBe(5);
    expect(pkg.manifest).toContain('rectifier.drl');
  });

  it('refuses routed copper whose net is split into disconnected islands', async () => {
    useProjectStore.setState(sheet());
    const splitLayout: PcbSceneInput = {
      widthMm: 40,
      heightMm: 20,
      thicknessMm: 1.6,
      copperThicknessMm: 0.035,
      layers: [
        { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', visible: true, side: 'top' },
        { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00', visible: true, side: 'bottom' },
      ],
      traces: [
        { id: 't1', net: 'A', layerId: 'top-cu', widthMm: 0.2, points: [{ x: 8, y: 10 }, { x: 12, y: 10 }] },
        { id: 't2', net: 'A', layerId: 'top-cu', widthMm: 0.2, points: [{ x: 20, y: 10 }, { x: 24, y: 10 }] },
      ],
      vias: [],
      components: [
        { id: 'id-R1', reference: 'R1', footprint: '0805', x: 17, y: 10 },
        { id: 'id-R2', reference: 'R2', footprint: '0805', x: 23, y: 10 },
      ],
    };
    useProjectStore.setState({ pcbLayout: splitLayout });
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const drc = await h.call('eda.drc', {}, b, allow);
    expect(drc.error).toBeUndefined();
    const report = drc.result as DrcResult;
    expect(report.splitNets).toEqual([{ net: 'A', groups: 2 }]);
    expect(report.shippable).toBe(false);
    expect(report.violations.some((violation) => violation.type === 'unconnected_net')).toBe(true);

    const fab = await h.call('eda.exportFab', { project: 'split' }, b, allow);
    expect(fab.error).toBeUndefined();
    expect((fab.result as ExportResult).refused).toBe(true);
    expect((fab.result as { splitNets?: unknown }).splitNets).toEqual([{ net: 'A', groups: 2 }]);
  });

  it('routes a headless payload when the canvas is empty', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const routed = await h.call('eda.route', { schematic: JSON.stringify(sheet()) }, budget(), allow);
    expect(routed.error).toBeUndefined();
    const route = routed.result as RouteResult;
    expect(route.source).toBe('payload');
    expect(route.traces).toBeGreaterThan(0);
    expect(useProjectStore.getState().pcbLayout?.traces).toHaveLength(route.traces);
  });

  it('refuses to invent a fab profile or to check a board that does not exist', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();
    const unknown = await h.call('eda.drc', { profile: 'OSH_PARK_premium' }, b, allow);
    expect(unknown.error).toMatch(/Unknown fab profile/);
    const missing = await h.call('eda.drc', {}, b, allow);
    expect(missing.error).toMatch(/No routed board/);
    const noExport = await h.call('eda.exportFab', {}, b, allow);
    expect(noExport.error).toMatch(/No routed board to export/);
  });

  it('gates fab export behind the approval gate', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();
    const denied = await h.call('eda.exportFab', { project: 'x', components: '[]', wires: '[]' }, b, () => false);
    expect(denied.approved).toBe(false);
    expect(denied.result).toBeUndefined();
    const gated = await h.call('eda.exportFab', { project: 'x', components: '[]', wires: '[]' }, b, () => true);
    expect(gated.error).toBeUndefined();
    // An empty board has nothing to violate, but it still produces a real manifest.
    expect((gated.result as ExportResult).shippable).toBe(true);
    expect((gated.result as ExportResult).files).toBe(10);
  });

  it('observes the routed board as JSON and an SVG of the same copper', async () => {
    useProjectStore.setState(sheet());
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const routed = await h.call('eda.route', {}, b, allow);
    expect(routed.error).toBeUndefined();
    const route = routed.result as RouteResult;

    const observed = await h.call('eda.observe', {}, b, allow);
    expect(observed.error).toBeUndefined();
    const { source, snapshot, svg } = observed.result as ObserveResult;
    expect(source).toBe('store');
    expect(snapshot.schema).toBe('folio.pcb/1');
    const copper = snapshot.layers.filter((layer) => layer.kind === 'copper');
    expect(copper.length).toBe(snapshot.board.copperLayers);
    expect(copper.length).toBeGreaterThanOrEqual(2);
    expect(copper.some((layer) => layer.side === 'top')).toBe(true);
    expect(copper.some((layer) => layer.side === 'bottom')).toBe(true);
    expect(Math.max(...copper.map((layer) => layer.yMm))).toBeGreaterThan(
      Math.min(...copper.map((layer) => layer.yMm)),
    );
    expect(snapshot.layers.some((layer) => layer.kind === 'mask')).toBe(true);
    expect(snapshot.layers.some((layer) => layer.kind === 'silk')).toBe(true);
    for (const layer of snapshot.layers) {
      expect(layer.thicknessMm).toBeGreaterThan(0);
      expect(Number.isFinite(layer.yMm)).toBe(true);
    }
    expect(snapshot.stats.components).toBe(2);
    expect(snapshot.stats.pads).toBe(4);
    expect(snapshot.stats.traces).toBe(route.traces);
    expect(snapshot.stats.traceLengthMm).toBeGreaterThan(0);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.components.map((component) => component.reference).sort()).toEqual(['R1', 'R2']);
    expect(snapshot.components[0].body.heightMm).toBeCloseTo(0.55, 9);
    for (const trace of snapshot.traces) {
      for (const point of trace.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(snapshot.board.widthMm);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(snapshot.board.heightMm);
      }
    }
    for (const component of snapshot.components) {
      for (const pad of component.pads) {
        expect(pad.x).toBeGreaterThanOrEqual(0);
        expect(pad.x).toBeLessThanOrEqual(snapshot.board.widthMm);
        expect(pad.y).toBeGreaterThanOrEqual(0);
        expect(pad.y).toBeLessThanOrEqual(snapshot.board.heightMm);
      }
    }

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`${snapshot.board.widthMm} × ${snapshot.board.heightMm} mm board`);
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(0);
    expect(svg).toContain('R1');
    expect(svg).toContain('top copper');
    expect(svg).not.toContain('placement warning');
  });

  it('observes a headless board payload and reports geometry that leaves the outline', async () => {
    const layout: PcbSceneInput = {
      widthMm: 40,
      heightMm: 20,
      thicknessMm: 1.6,
      copperThicknessMm: 0.035,
      layers: [
        { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', visible: true, side: 'top' },
        { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00', visible: true, side: 'bottom' },
      ],
      traces: [
        { id: 't1', net: 'A', layerId: 'top-cu', widthMm: 0.25, points: [{ x: 2, y: 10 }, { x: 60, y: 10 }] },
      ],
      vias: [],
      components: [{ id: 'r1', reference: 'R1', footprint: '0805', x: 20, y: 10 }],
    };
    const h = new AgentHarness();
    registerEdaTools(h);

    const observed = await h.call('eda.observe', { board: JSON.stringify(layout) }, budget(), allow);
    expect(observed.error).toBeUndefined();
    const { source, snapshot, svg } = observed.result as ObserveResult;
    expect(source).toBe('payload');
    expect(snapshot.stats.components).toBe(1);
    expect(snapshot.stats.pads).toBe(2);
    expect(snapshot.stats.traces).toBe(1);
    expect(snapshot.stats.traceLengthMm).toBeCloseTo(58, 9);
    expect(snapshot.warnings).toContainEqual(expect.objectContaining({
      code: 'trace-outside-board',
      elementId: 't1',
    }));
    // Pads keep board coordinates, not the scene's centred coordinates.
    const padXs = snapshot.components[0].pads.map((pad) => pad.x).sort((left, right) => left - right);
    expect(padXs).toHaveLength(2);
    expect(padXs[0]).toBeCloseTo(19.1, 6);
    expect(padXs[1]).toBeCloseTo(20.9, 6);
    for (const pad of snapshot.components[0].pads) {
      expect(pad.y).toBeCloseTo(10, 6);
    }
    expect(svg).toContain('1 placement warning(s)');
    expect(svg).toContain('R1');
  });

  it('refuses to observe a board that does not exist or is malformed', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();
    const missing = await h.call('eda.observe', {}, b, allow);
    expect(missing.error).toMatch(/no routed board/i);
    const malformed = await h.call('eda.observe', { board: '{not json' }, b, allow);
    expect(malformed.error).toMatch(/not valid JSON/);
    const incomplete = await h.call('eda.observe', { board: JSON.stringify({ widthMm: 10 }) }, b, allow);
    expect(incomplete.error).toMatch(/needs widthMm/);
  });

  it('moves a placed part and re-routes so copper matches the new pads', async () => {
    const demo = buildDemoBoard();
    useProjectStore.setState({ components: demo.components, wires: demo.wires, pcbLayout: null });
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const routed = await h.call('eda.route', {}, b, allow);
    expect(routed.error).toBeUndefined();
    const before = useProjectStore.getState().pcbLayout;
    const diode = before?.components.find((component) => component.reference === 'D1');
    expect(diode).toBeDefined();

    const moved = await h.call('eda.movePart', {
      reference: 'D1',
      x: (diode?.x ?? 0) + 2,
      y: (diode?.y ?? 0) + 3,
    }, b, allow);
    expect(moved.error).toBeUndefined();
    const result = moved.result as {
      position: { x: number; y: number };
      rotation: number;
      traces: number;
      completionRate: number;
      unrouted: string[];
      warnings: string[];
    };
    expect(result.position.x).toBeCloseTo((diode?.x ?? 0) + 2, 9);
    expect(result.position.y).toBeCloseTo((diode?.y ?? 0) + 3, 9);
    expect(result.warnings).toEqual([]);
    expect(result.unrouted).toEqual([]);
    expect(result.completionRate).toBe(1);

    const after = useProjectStore.getState().pcbLayout;
    const movedDiode = after?.components.find((component) => component.reference === 'D1');
    expect(movedDiode?.x).toBeCloseTo((diode?.x ?? 0) + 2, 9);
    expect(movedDiode?.y).toBeCloseTo((diode?.y ?? 0) + 3, 9);
    expect(after?.traces).toHaveLength(result.traces);
    for (const trace of after?.traces ?? []) {
      for (const point of trace.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(after?.widthMm ?? 0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(after?.heightMm ?? 0);
      }
    }

    const observed = await h.call('eda.observe', {}, b, allow);
    const { snapshot } = observed.result as ObserveResult;
    const observedDiode = snapshot.components.find((component) => component.reference === 'D1');
    expect(observedDiode?.x).toBeCloseTo((diode?.x ?? 0) + 2, 6);
    expect(observedDiode?.y).toBeCloseTo((diode?.y ?? 0) + 3, 6);

    const drc = await h.call('eda.drc', {}, b, allow);
    expect(drc.error).toBeUndefined();
    const report = drc.result as DrcResult;
    expect(report.source).toBe('routed-layout');
    expect(report.traces).toBe(result.traces);
    expect(report.shippable).toBe(true);
  });

  it('refuses an impossible or un-reroutable move instead of leaving stale copper', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const noBoard = await h.call('eda.movePart', { reference: 'D1', x: 10, y: 10 }, b, allow);
    expect(noBoard.error).toMatch(/no routed board/i);

    const payload = await h.call('eda.route', { schematic: JSON.stringify(sheet()) }, b, allow);
    expect(payload.error).toBeUndefined();
    const readOnly = await h.call('eda.movePart', { reference: 'R1', x: 10, y: 10 }, b, allow);
    expect(readOnly.error).toMatch(/read-only/i);

    const demo = buildDemoBoard();
    useProjectStore.setState({ components: demo.components, wires: demo.wires, pcbLayout: null });
    await h.call('eda.route', {}, b, allow);
    const missing = await h.call('eda.movePart', { reference: 'NOPE', x: 10, y: 10 }, b, allow);
    expect(missing.error).toMatch(/no placed part/i);
    const outside = await h.call('eda.movePart', { reference: 'D1', x: 0.5, y: 0.5 }, b, allow);
    expect(outside.error).toMatch(/outside the .* board/i);
    const nonFinite = await h.call('eda.movePart', { reference: 'D1', x: Number.POSITIVE_INFINITY, y: 10 }, b, allow);
    expect(nonFinite.error).toMatch(/finite x\/y/);
  });

  it('adds agent-authored copper and a via that observation and DRC both see', async () => {
    useProjectStore.setState(sheet());
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const routed = await h.call('eda.route', {}, b, allow);
    expect(routed.error).toBeUndefined();
    const before = useProjectStore.getState().pcbLayout;
    expect(before).not.toBeNull();

    const y = Math.min(4, (before?.heightMm ?? 10) / 2);
    const points = JSON.stringify([
      { x: 4, y },
      { x: (before?.widthMm ?? 20) - 4, y },
    ]);
    const added = await h.call('eda.addTrace', { net: 'A', points, layerId: 'top-cu', widthMm: 0.3 }, b, allow);
    expect(added.error).toBeUndefined();
    const first = added.result as {
      trace: { id: string; net: string; layerId: string; widthMm: number; points: Array<{ x: number; y: number }> };
      traces: number;
      warnings: string[];
    };
    const firstId = first.trace.id;
    expect(firstId).toMatch(/^agent-trace-\d+$/);
    expect(first.trace.net).toBe('A');
    expect(first.trace.layerId).toBe('top-cu');
    expect(first.trace.widthMm).toBe(0.3);
    expect(first.trace.points).toHaveLength(2);
    expect(first.traces).toBe((before?.traces.length ?? 0) + 1);
    expect(first.warnings).toEqual([]);

    const second = await h.call('eda.addTrace', { net: 'A', points }, b, allow);
    expect(second.error).toBeUndefined();
    const secondId = (second.result as { trace: { id: string } }).trace.id;
    expect(secondId).toMatch(/^agent-trace-\d+$/);
    expect(secondId).not.toBe(firstId);

    const via = await h.call('eda.addVia', {
      net: 'A',
      x: (before?.widthMm ?? 20) - 2,
      y: 2,
      padDiameterMm: 0.6,
      drillDiameterMm: 0.3,
    }, b, allow);
    expect(via.error).toBeUndefined();
    const viaId = (via.result as { via: { id: string } }).via.id;
    expect(viaId).toMatch(/^agent-via-\d+$/);

    const observed = await h.call('eda.observe', {}, b, allow);
    expect(observed.error).toBeUndefined();
    const { snapshot } = observed.result as ObserveResult;
    expect(snapshot.stats.traces).toBe((before?.traces.length ?? 0) + 2);
    expect(snapshot.stats.vias).toBe((before?.vias.length ?? 0) + 1);
    expect(snapshot.traces.find((trace) => trace.id === firstId)?.net).toBe('A');
    expect(snapshot.vias.find((entry) => entry.id === viaId)?.net).toBe('A');

    const drc = await h.call('eda.drc', {}, b, allow);
    const report = drc.result as DrcResult;
    expect(drc.error).toBeUndefined();
    expect(report.source).toBe('routed-layout');
    expect(report.traces).toBe((before?.traces.length ?? 0) + 2);
    expect(report.vias).toBe((before?.vias.length ?? 0) + 1);
  });

  it('refuses malformed or off-board agent copper instead of clipping it', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = budget();

    const noBoardTrace = await h.call('eda.addTrace', { net: 'A', points: '[]' }, b, allow);
    expect(noBoardTrace.error).toMatch(/no routed board/i);
    const noBoardVia = await h.call('eda.addVia', { net: 'A', x: 1, y: 1 }, b, allow);
    expect(noBoardVia.error).toMatch(/no routed board/i);

    useProjectStore.setState(sheet());
    await h.call('eda.route', {}, b, allow);
    const validPoints = JSON.stringify([{ x: 2, y: 2 }, { x: 10, y: 2 }]);

    const wrongLayer = await h.call('eda.addTrace', { net: 'A', points: validPoints, layerId: 'top-silk' }, b, allow);
    expect(wrongLayer.error).toMatch(/not a copper layer/i);
    const noNet = await h.call('eda.addTrace', { net: ' ', points: validPoints }, b, allow);
    expect(noNet.error).toMatch(/needs the net/i);
    const badJson = await h.call('eda.addTrace', { net: 'A', points: '{not json' }, b, allow);
    expect(badJson.error).toMatch(/JSON array/);
    const onePoint = await h.call('eda.addTrace', { net: 'A', points: JSON.stringify([{ x: 2, y: 2 }]) }, b, allow);
    expect(onePoint.error).toMatch(/at least two/i);
    const offBoard = await h.call('eda.addTrace', { net: 'A', points: JSON.stringify([{ x: -1, y: 2 }, { x: 10, y: 2 }]) }, b, allow);
    expect(offBoard.error).toMatch(/outside the .* board/i);
    const duplicate = await h.call('eda.addTrace', { net: 'A', points: JSON.stringify([{ x: 2, y: 2 }, { x: 2, y: 2 }]) }, b, allow);
    expect(duplicate.error).toMatch(/identical/i);
    const zeroWidth = await h.call('eda.addTrace', { net: 'A', points: validPoints, widthMm: 0 }, b, allow);
    expect(zeroWidth.error).toMatch(/positive number/i);

    const badVia = await h.call('eda.addVia', { net: 'A', x: 5, y: 5, padDiameterMm: 0.3, drillDiameterMm: 0.6 }, b, allow);
    expect(badVia.error).toMatch(/larger than/i);
    const outsideVia = await h.call('eda.addVia', { net: 'A', x: -1, y: 5 }, b, allow);
    expect(outsideVia.error).toMatch(/outside the .* board/i);
    const viaNoNet = await h.call('eda.addVia', { net: ' ', x: 5, y: 5 }, b, allow);
    expect(viaNoNet.error).toMatch(/needs the net/i);
  });

  it('plans simulate-route-observe-drc-export with fab gated', () => {
    const plan = planEdaRun('build a blinker');
    expect(plan.steps.map((s) => s.tool)).toEqual([
      'eda.simulate', 'eda.route', 'eda.observe', 'eda.drc', 'eda.exportFab',
    ]);
    expect(plan.needsApproval).toEqual(['eda.exportFab']);
  });

  it('routes schematic inspection to cad.observe without hijacking board requests', () => {
    const context = { netlist: '{}', components: '[]', wires: '[]', schematic: '{}' };
    expect(planEdaFlow('Inspect the live schematic', context)?.steps[0].tool).toBe('cad.observe');
    expect(planEdaFlow('Observe the sheet', context)?.steps[0].tool).toBe('cad.observe');

    const board = planEdaFlow('Inspect the routed board', context);
    expect(board?.steps.map((step) => step.tool)).not.toContain('cad.observe');
  });
});
