import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  X,
  Wrench,
  RotateCcw,
  Download,
  Layers,
  Eye,
  EyeOff,
  Zap,
  BarChart3,
  Box,
  Target,
  Printer
} from 'lucide-react';
import ThreeCanvas, { type MechanicalSupportMarker, type ThreeView } from '../3d/ThreeCanvas';
import { buildDemoEnclosure } from '../../lib/demo/demoEnclosure';
import {
  analysePart,
  buildPart,
  type MechanicalPart,
} from '../../lib/mechanical/partModel';
import { MechanicalDesignEngine } from '../../lib/mechanical/mechanicalDesign';
import {
  mateHolds,
  solveMateTranslation,
  type BodyFrame,
  type Mat3,
  type Mate,
} from '../../lib/mechanical/assembly';
import { getMaterial, MATERIALS } from '../../lib/mechanical/materials';
import {
  solveAxialBar,
  solveBarConduction,
  solveElectrostaticField,
  solveTruss,
} from '../../lib/simulation/multiphysics';
import {
  analyseGasCycle,
  analysePipeFlow,
  type GasCycleId,
} from '../../lib/mechanical/thermofluids';
import {
  analyseRoomAcoustics,
  criticalDistanceM,
  partitionTransmissionLoss,
} from '../../lib/mechanical/acoustics';
import {
  searchCantileverSection,
  type CantileverSizingResult,
} from '../../lib/optimization/designSearch';
import { GCodeExporter } from '../../lib/3d/gcodeExporter';
import { buildEnclosureTrayMesh } from '../../lib/3d/printableEnclosure';
import { buildPartDrawing } from '../../lib/mechanical/partDrawing';
import { downloadFile } from '../../lib/exportUtils';
import { describeError } from '../../lib/utils';
import { useDemoRequest } from '../workspace/useDemoRequest';
import { useProjectStore } from '../../stores/useProjectStore';
import type { MechanicalComponent as ViewMechanicalComponent } from '../../types/toolbox';

interface MechanicalDesignPanelProps {
  onClose: () => void;
}

interface AnalysisResult {
  displacement: Array<{ nodeId: string; x: number; y: number; z: number }>;
  stress: Array<{ nodeId: string; vonMises: number; principal: [number, number, number] }>;
  strain: Array<{ nodeId: string; x: number; y: number; z: number }>;
  modal: { partId: string; partName: string; naturalFrequencies: number[] };
  buckling: { partId: string; partName: string; criticalLoad: number; mode: number };
  fatigue: { cycles: number; safetyFactor: number };
  thermal?: {
    lidTempC: number;
    ambientC: number;
    temperatureRise: number;
    resistanceKW: number;
    dissipationW: number;
    verdict: string;
  };
}

/** Row-major rotation matrix for intrinsic XYZ Euler angles (Rz·Ry·Rx). */
function eulerToMatrix(rotation: [number, number, number]): Mat3 {
  const [rx, ry, rz] = rotation;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function emptyResult(thermal?: AnalysisResult['thermal']): AnalysisResult {
  return {
    displacement: [],
    stress: [],
    strain: [],
    modal: { partId: '', partName: 'No part', naturalFrequencies: [] },
    buckling: { partId: '', partName: 'No part', criticalLoad: 0, mode: 1 },
    fatigue: { cycles: 0, safetyFactor: 0 },
    thermal,
  };
}

type FieldMode = 'conduction' | 'axial' | 'truss' | 'electrostatic' | 'thermo' | 'pipe' | 'acoustics';

interface FieldInputs {
  lengthM: number;
  areaMm2: number;
  conductivity: number;
  startC: number;
  endC: number;
  generationKWm3: number;
  youngsGPa: number;
  loadN: number;
  spanM: number;
  heightM: number;
  separationMm: number;
  plateWidthMm: number;
  relativePermittivity: number;
  voltage: number;
  compressionRatio: number;
  cutoffRatio: number;
  pipeLengthM: number;
  pipeDiameterMm: number;
  pipeFlowLps: number;
  roughnessMm: number;
  minorLossK: number;
  elevationM: number;
  roomVolumeM3: number;
  roomSurfaceM2: number;
  absorption: number;
  partitionMassKgM2: number;
  frequencyHz: number;
}

interface FieldResult {
  summary: Array<[string, string]>;
  note: string;
}

const DEFAULT_FIELD_INPUTS: FieldInputs = {
  lengthM: 0.2,
  areaMm2: 100,
  conductivity: 167,
  startC: 25,
  endC: 100,
  generationKWm3: 0,
  youngsGPa: 69,
  loadN: 1000,
  spanM: 1,
  heightM: 0.5,
  separationMm: 2,
  plateWidthMm: 50,
  relativePermittivity: 1,
  voltage: 100,
  compressionRatio: 8,
  cutoffRatio: 2,
  pipeLengthM: 20,
  pipeDiameterMm: 50,
  pipeFlowLps: 2,
  roughnessMm: 0.0015,
  minorLossK: 2,
  elevationM: 0,
  roomVolumeM3: 100,
  roomSurfaceM2: 120,
  absorption: 0.2,
  partitionMassKgM2: 10,
  frequencyHz: 500,
};

const FIELD_MODES: ReadonlyArray<{ id: FieldMode; label: string; description: string }> = [
  {
    id: 'conduction',
    label: 'Bar conduction',
    description: '1D steady heat conduction with fixed end temperatures and optional uniform generation.',
  },
  {
    id: 'axial',
    label: 'Axial bar',
    description: 'Direct-stiffness axial bar: elongation, stress and fixed-end reaction.',
  },
  {
    id: 'truss',
    label: 'Two-bar truss',
    description: '2D pin-jointed truss (direct stiffness) with a vertical apex load.',
  },
  {
    id: 'electrostatic',
    label: 'Parallel plates',
    description: '2D Laplace field between plates; field, capacitance and stored energy from the grid.',
  },
  {
    id: 'thermo',
    label: 'Gas / steam cycle',
    description: 'Air-standard Carnot, Otto, Diesel and Brayton cycles, plus an ideal Rankine cycle over saturated-water data.',
  },
  {
    id: 'pipe',
    label: 'Pipe flow (Darcy–Weisbach)',
    description: 'Friction factor, head loss, pressure drop and hydraulic power for a single pipe with minor losses.',
  },
  {
    id: 'acoustics',
    label: 'Room acoustics',
    description: 'Sabine and Eyring reverberation time plus mass-law partition transmission loss.',
  },
];

const GAS_CYCLE_OPTIONS: ReadonlyArray<{ id: GasCycleId; label: string }> = [
  { id: 'otto', label: 'Otto (spark ignition)' },
  { id: 'diesel', label: 'Diesel (compression ignition)' },
  { id: 'brayton', label: 'Brayton (gas turbine)' },
  { id: 'carnot', label: 'Carnot (upper bound)' },
  { id: 'rankine', label: 'Rankine (steam)' },
];

function FieldNumber({
  id,
  label,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step?: number | 'any';
  onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={id} className="text-xs text-muted-foreground">
      {label}
      <input
        id={id}
        type="number"
        step={step ?? 'any'}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
      />
    </label>
  );
}

function enclosureThermalResult(): AnalysisResult {
  const demo = buildDemoEnclosure();
  return emptyResult({
    lidTempC: demo.thermal.steadyStateTemp,
    ambientC: 25,
    temperatureRise: demo.thermal.temperatureRise,
    resistanceKW: demo.thermal.thermalResistance,
    dissipationW: demo.dissipationW,
    verdict: demo.summary.verdict,
  });
}

/**
 * The demo enclosure as five printable solids (floor + four walls) so the
 * assembly viewport shows the same outer dimensions the G-code and STEP
 * exports use. The tray slicer still consumes the watertight mesh; these boxes
 * are for inspection, selection, and drawings.
 */
function enclosureAssemblyParts(): MechanicalPart[] {
  const spec = buildDemoEnclosure().spec;
  const tray = buildEnclosureTrayMesh(spec);
  const outerW = tray.outerMm.width / 1000;
  const outerD = tray.outerMm.depth / 1000;
  const outerH = tray.outerMm.height / 1000;
  const wall = tray.wallMm / 1000;
  const floor = tray.floorMm / 1000;
  const wallHeight = outerH - floor;
  const wallCenterY = -outerH / 2 + floor + wallHeight / 2;
  const fixed = { fixed: true, pinned: false, roller: false };
  return [
    buildPart({
      id: 'enclosure-floor',
      name: 'Enclosure floor',
      kind: 'plate',
      dimensions: { length: outerW, width: outerD, height: floor },
      position: [0, -outerH / 2 + floor / 2, 0],
      materialKey: 'abs',
      constraints: fixed,
    }),
    buildPart({
      id: 'enclosure-left',
      name: 'Enclosure left wall',
      kind: 'plate',
      dimensions: { length: wall, width: outerD, height: wallHeight },
      position: [-outerW / 2 + wall / 2, wallCenterY, 0],
      materialKey: 'abs',
      constraints: fixed,
    }),
    buildPart({
      id: 'enclosure-right',
      name: 'Enclosure right wall',
      kind: 'plate',
      dimensions: { length: wall, width: outerD, height: wallHeight },
      position: [outerW / 2 - wall / 2, wallCenterY, 0],
      materialKey: 'abs',
      constraints: fixed,
    }),
    buildPart({
      id: 'enclosure-back',
      name: 'Enclosure back wall',
      kind: 'plate',
      dimensions: { length: outerW - 2 * wall, width: wall, height: wallHeight },
      position: [0, wallCenterY, -outerD / 2 + wall / 2],
      materialKey: 'abs',
      constraints: fixed,
    }),
    buildPart({
      id: 'enclosure-front',
      name: 'Enclosure front wall',
      kind: 'plate',
      dimensions: { length: outerW - 2 * wall, width: wall, height: wallHeight },
      position: [0, wallCenterY, outerD / 2 - wall / 2],
      materialKey: 'abs',
      constraints: fixed,
    }),
  ];
}

export default function MechanicalDesignPanel({ onClose }: MechanicalDesignPanelProps) {
  const [enclosureVerdict] = useState(() => buildDemoEnclosure().summary.verdict.split(':')[0]);
  // Parts live in the project store so an agent editing them and the 3D
  // viewport a human is watching are always the same bodies.
  const parts = useProjectStore((state) => state.mechanicalParts);
  const setParts = useProjectStore((state) => state.setMechanicalParts);
  const [selectedComponent, setSelectedComponent] = useState<string>('beam-1');
  const sizingTarget = parts.find(part => part.kind === 'beam');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisType, setAnalysisType] = useState<'static' | 'modal' | 'thermal' | 'fatigue'>('static');
  const [view, setView] = useState<ThreeView>('iso');
  const [showLoads, setShowLoads] = useState(true);
  const [showConstraints, setShowConstraints] = useState(false);
  const [showStress, setShowStress] = useState(true);

  /*
   * Reduced-order multiphysics calculators. These are the same verified
   * solvers used by the test suite (1D conduction, axial/truss stiffness,
   * 2D Laplace), exposed with editable inputs — not a 3D FEM claim.
   */
  const [fieldMode, setFieldMode] = useState<FieldMode>('conduction');
  const [cycleId, setCycleId] = useState<GasCycleId>('otto');
  const [fieldInputs, setFieldInputs] = useState<FieldInputs>(DEFAULT_FIELD_INPUTS);
  const [fieldResult, setFieldResult] = useState<FieldResult | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const updateField = <K extends keyof FieldInputs>(key: K, value: number) =>
    setFieldInputs(current => ({ ...current, [key]: value }));

  const [mateKind, setMateKind] = useState<'distance' | 'coincident'>('distance');
  const [mateFixedId, setMateFixedId] = useState('beam-1');
  const [mateMovingId, setMateMovingId] = useState('plate-1');
  const [mateGapMm, setMateGapMm] = useState(40);
  const [mateVerdict, setMateVerdict] = useState<{ ok: boolean; message: string } | null>(null);

  /*
   * Bounded section search. Width/height bounds are fixed to a manufacturable
   * plate envelope; the slenderness limit keeps the optimum from degenerating
   * into a razor-thin strip. Every reported section is re-checked against the
   * closed-form stress and deflection limits.
   */
  const [sizingMaterialKey, setSizingMaterialKey] = useState('steel');
  const [sizingSpanM, setSizingSpanM] = useState(0.6);
  const [sizingLoadN, setSizingLoadN] = useState(500);
  const [sizingDeflectionMm, setSizingDeflectionMm] = useState(3);
  const [sizingSafetyFactor, setSizingSafetyFactor] = useState(1.5);
  const [sizingMaxAspect, setSizingMaxAspect] = useState(20);
  const [sizingResult, setSizingResult] = useState<CantileverSizingResult | null>(null);
  const [sizingError, setSizingError] = useState<string | null>(null);
  const [sizingBusy, setSizingBusy] = useState(false);

  /*
   * Printable enclosure: the STEP flow models the case as a tub plus lid; the
   * FDM flow prints the tub as one open-top tray. The mesh is generated from
   * the same enclosure spec, so the printed part and the STEP agree.
   */
  const printPart = useMemo(() => buildEnclosureTrayMesh(buildDemoEnclosure().spec), []);
  const [printLayerHeight, setPrintLayerHeight] = useState(0.2);
  const [printInfill, setPrintInfill] = useState(20);
  const [printRaft, setPrintRaft] = useState(true);
  const [printSkirt, setPrintSkirt] = useState(false);
  const [printBrim, setPrintBrim] = useState(0);
  const [printStatus, setPrintStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [stepStatus, setStepStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [drawingStatus, setDrawingStatus] = useState<string | null>(null);

  /** Slice the tray; the demo runs this without triggering a download. */
  const runPrintExport = (download: boolean) => {
    try {
      const exporter = new GCodeExporter({
        upAxis: 'y',
        layerHeight: printLayerHeight,
        infill: printInfill,
        raft: printRaft,
        skirt: printSkirt,
        brim: printBrim,
        nozzleTemperature: 210,
        bedTemperature: 60,
        retractionDistance: 2,
      });
      const layers = exporter.sliceMesh(printPart.mesh);
      const printableLayers = layers.filter((layer) => layer.contours.length > 0).length;
      if (printableLayers === 0) {
        throw new Error('The enclosure mesh produced no printable layers.');
      }
      const gcode = exporter.exportMeshToGCode(printPart.mesh);
      const warnings = exporter.getWarnings();
      if (download) downloadFile(gcode, 'enclosure_tray.gcode', 'text/plain');
      setPrintStatus({
        ok: true,
        message: `G-code ${download ? 'ready' : 'sliced'}: ${printPart.outerMm.width.toFixed(0)} × ${printPart.outerMm.depth.toFixed(0)} × ${printPart.outerMm.height.toFixed(1)} mm tray, ${printableLayers} layers, ${gcode.length.toLocaleString()} bytes${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''}.`,
      });
    } catch (error) {
      setPrintStatus({ ok: false, message: describeError(error) });
    }
  };

  const handleExportPrint = () => runPrintExport(true);

  const handleOptimizeSection = async () => {
    setSizingBusy(true);
    setSizingError(null);
    try {
      const material = MATERIALS[sizingMaterialKey];
      if (!material) throw new Error(`Unknown material ${sizingMaterialKey}.`);
      const result = await searchCantileverSection({
        spanM: sizingSpanM,
        loadN: sizingLoadN,
        material: {
          densityKgM3: material.density,
          youngsModulusPa: material.youngsModulus,
          yieldStrengthPa: material.yieldStrength,
        },
        safetyFactor: sizingSafetyFactor,
        deflectionLimitM: sizingDeflectionMm / 1000,
        maxAspectRatio: sizingMaxAspect,
        width: { minM: 0.002, maxM: 0.06 },
        height: { minM: 0.01, maxM: 0.12 },
      });
      setSizingResult(result);
    } catch (error) {
      setSizingResult(null);
      setSizingError(describeError(error));
    } finally {
      setSizingBusy(false);
    }
  };

  const handleApplySection = () => {
    if (!sizingResult || !sizingResult.feasible) return;
    const material = MATERIALS[sizingMaterialKey];
    const selected = parts.find(part => part.kind === 'beam');
    if (!material || !selected) {
      setSizingError('A beam part must exist before applying a searched section.');
      return;
    }
    const volume = sizingSpanM * sizingResult.widthM * sizingResult.heightM;
    const mass = volume * material.density;
    setParts(current =>
      current.map(part =>
        part.id !== selected.id
          ? part
          : {
              ...part,
              materialKey: sizingMaterialKey,
              material,
              dimensions: { length: sizingSpanM, width: sizingResult.widthM, height: sizingResult.heightM },
              properties: {
                volume,
                mass,
                centerOfMass: part.properties.centerOfMass,
                momentOfInertia: [
                  (mass * (sizingResult.widthM ** 2 + sizingResult.heightM ** 2)) / 12,
                  (mass * (sizingSpanM ** 2 + sizingResult.heightM ** 2)) / 12,
                  (mass * (sizingSpanM ** 2 + sizingResult.widthM ** 2)) / 12,
                ],
              },
              loads: {
                ...part.loads,
                forces: [{ x: 0, y: -1, z: 0, magnitude: sizingLoadN }],
              },
            },
      ),
    );
    setAnalysisResult(null);
    setSizingError(null);
  };

  const mateInputs = () => {
    const fixedPart = parts.find(candidate => candidate.id === mateFixedId);
    const movingPart = parts.find(candidate => candidate.id === mateMovingId);
    if (!fixedPart || !movingPart) throw new Error('Choose both a reference and a moving part.');
    if (fixedPart.id === movingPart.id) throw new Error('A part cannot be mated to itself.');
    const fixed: BodyFrame = { position: fixedPart.position, rotation: eulerToMatrix(fixedPart.rotation) };
    const moving: BodyFrame = { position: movingPart.position, rotation: eulerToMatrix(movingPart.rotation) };
    const mate: Mate =
      mateKind === 'distance'
        ? { kind: 'distance', pointA: [0, 0, 0], pointB: [0, 0, 0], value: Math.max(0, mateGapMm) / 1000 }
        : { kind: 'coincident', pointA: [0, 0, 0], pointB: [0, 0, 0] };
    return { fixed, moving, mate, fixedPart, movingPart };
  };

  const handleCheckMate = () => {
    try {
      const { fixed, moving, mate } = mateInputs();
      const holds = mateHolds(fixed, moving, mate, 1e-6);
      setMateVerdict(
        holds
          ? { ok: true, message: 'The current placement satisfies the mate.' }
          : { ok: false, message: 'The current placement does not satisfy the mate — solve it to apply the requested offset.' },
      );
    } catch (error) {
      setMateVerdict({ ok: false, message: describeError(error) });
    }
  };

  const handleSolveMate = () => {
    try {
      const { fixed, moving, mate, fixedPart, movingPart } = mateInputs();
      const solved = solveMateTranslation(fixed, moving, mate);
      const position: [number, number, number] = [solved[0], solved[1], solved[2]];
      const solvedFrame: BodyFrame = { ...moving, position };
      if (!mateHolds(fixed, solvedFrame, mate, 1e-6)) {
        throw new Error('The closed-form solution does not satisfy the mate; check the part geometry.');
      }
      setParts(current =>
        current.map(part =>
          part.id === movingPart.id
            ? { ...part, position, properties: { ...part.properties, centerOfMass: [...position] as [number, number, number] } }
            : part,
        ),
      );
      setAnalysisResult(null);
      const separationMm =
        Math.hypot(
          position[0] - fixed.position[0],
          position[1] - fixed.position[1],
          position[2] - fixed.position[2],
        ) * 1000;
      setMateVerdict({
        ok: true,
        message: `Mate holds — ${movingPart.name} moved to [${position.map(value => value.toFixed(3)).join(', ')}] m (${separationMm.toFixed(1)} mm from ${fixedPart.name}).`,
      });
    } catch (error) {
      setMateVerdict({ ok: false, message: describeError(error) });
    }
  };

  const applySelectedPart = () => {
    const part = parts.find(candidate => candidate.id === selectedComponent);
    if (!part) return;
    const areaMm2 = Math.max(part.dimensions.width * part.dimensions.height * 1e6, 1e-6);
    const load = part.loads.forces.reduce((sum, force) => sum + force.magnitude, 0);
    setFieldInputs(current => ({
      ...current,
      lengthM: part.dimensions.length,
      spanM: part.dimensions.length,
      areaMm2,
      conductivity: part.material.thermalConductivity,
      youngsGPa: part.material.youngsModulus / 1e9,
      loadN: load > 0 ? load : current.loadN,
    }));
    setFieldResult(null);
  };

  const solveField = () => {
    setFieldError(null);
    try {
      const area = Math.max(fieldInputs.areaMm2, 0) * 1e-6;
      if (fieldMode === 'conduction') {
        const result = solveBarConduction({
          length: fieldInputs.lengthM,
          area,
          thermalConductivity: fieldInputs.conductivity,
          segments: 40,
          temperatureAtStart: fieldInputs.startC,
          temperatureAtEnd: fieldInputs.endC,
          heatGeneration: fieldInputs.generationKWm3 * 1e3,
        });
        const peak = Math.max(...result.temperatures);
        setFieldResult({
          summary: [
            ['Peak temperature', `${peak.toFixed(2)} °C`],
            ['Midpoint temperature', `${result.temperatures[20].toFixed(2)} °C`],
            ['Heat flux', `${(result.flux / 1e3).toFixed(3)} kW/m²`],
            ['Generated power', `${result.generatedPower.toFixed(3)} W`],
            ['Residual', result.residual.toExponential(2)],
          ],
          note: result.converged
            ? 'Steady state reached; flux is positive from the hot end to the cold end.'
            : 'The solve did not reach the residual target — treat the numbers as provisional.',
        });
      } else if (fieldMode === 'axial') {
        const result = solveAxialBar({
          length: fieldInputs.lengthM,
          area,
          youngsModulus: fieldInputs.youngsGPa * 1e9,
          segments: 20,
          endLoad: fieldInputs.loadN,
        });
        setFieldResult({
          summary: [
            ['Elongation', `${(result.displacements[result.displacements.length - 1] * 1e3).toFixed(4)} mm`],
            ['Axial stress', `${(result.stresses[0] / 1e6).toFixed(3)} MPa`],
            ['Reaction at fixed end', `${result.reactionForce.toFixed(1)} N`],
            ['Residual', result.residual.toExponential(2)],
          ],
          note: 'Positive load is tension. The reaction equals the applied load in equilibrium.',
        });
      } else if (fieldMode === 'truss') {
        const span = fieldInputs.spanM;
        const height = Math.max(fieldInputs.heightM, 1e-9);
        const memberArea = Math.max(fieldInputs.areaMm2, 1e-9) * 1e-6;
        const modulus = fieldInputs.youngsGPa * 1e9;
        const result = solveTruss(
          [
            { x: 0, y: 0, fixX: true, fixY: true },
            { x: span, y: 0, fixX: true, fixY: true },
            { x: span / 2, y: -height, loadY: -Math.abs(fieldInputs.loadN) },
          ],
          [
            { from: 0, to: 2, area: memberArea, youngsModulus: modulus },
            { from: 1, to: 2, area: memberArea, youngsModulus: modulus },
          ],
        );
        const apex = result.displacements[2];
        setFieldResult({
          summary: [
            ['Apex deflection', `${(Math.hypot(apex.x, apex.y) * 1e3).toFixed(3)} mm`],
            ['Member 1 force', `${result.memberForces[0].toFixed(1)} N`],
            ['Member 2 force', `${result.memberForces[1].toFixed(1)} N`],
            ['Support reactions', `${result.reactions[0].y.toFixed(1)} / ${result.reactions[1].y.toFixed(1)} N`],
            ['Residual', result.residual.toExponential(2)],
          ],
          note: 'Positive member force is tension. Supports are pinned at both ends of the span.',
        });
      } else if (fieldMode === 'electrostatic') {
        const result = solveElectrostaticField({
          separation: fieldInputs.separationMm * 1e-3,
          plateWidth: fieldInputs.plateWidthMm * 1e-3,
          relativePermittivity: fieldInputs.relativePermittivity,
          cellsX: 20,
          cellsY: 12,
          upperPlateVoltage: fieldInputs.voltage,
          lowerPlateVoltage: 0,
        });
        const separation = fieldInputs.separationMm * 1e-3;
        const side = fieldInputs.plateWidthMm * 1e-3;
        const analytic = (8.8541878128e-12 * fieldInputs.relativePermittivity * side * side) / separation;
        setFieldResult({
          summary: [
            ['Mean field', `${(result.meanFieldMagnitude / 1e3).toFixed(3)} kV/m`],
            ['Capacitance', `${(result.capacitance * 1e12).toFixed(3)} pF`],
            ['Parallel-plate estimate', `${(analytic * 1e12).toFixed(3)} pF`],
            ['Stored energy', `${(result.energy * 1e6).toFixed(4)} µJ`],
            ['Residual', result.residual.toExponential(2)],
          ],
          note: 'A 2D Laplace field with Neumann side walls. The estimate assumes no fringing; the solve includes it at the plate edges.',
        });
      } else if (fieldMode === 'thermo') {
        const cycleInput =
          cycleId === 'carnot'
            ? { cycle: 'carnot' as const, coldK: fieldInputs.startC + 273.15, hotK: fieldInputs.endC + 273.15 }
            : cycleId === 'otto'
              ? {
                cycle: 'otto' as const,
                coldK: fieldInputs.startC + 273.15,
                compressionRatio: fieldInputs.compressionRatio,
                heatInputKJPerKg: 800,
              }
              : cycleId === 'diesel'
                ? {
                  cycle: 'diesel' as const,
                  coldK: fieldInputs.startC + 273.15,
                  compressionRatio: fieldInputs.compressionRatio,
                  cutoffRatio: fieldInputs.cutoffRatio,
                }
                : cycleId === 'brayton'
                  ? {
                    cycle: 'brayton' as const,
                    coldK: fieldInputs.startC + 273.15,
                    pressureRatio: fieldInputs.compressionRatio,
                    turbineInletK: fieldInputs.endC + 273.15,
                  }
                  : {
                    cycle: 'rankine' as const,
                    boilerPressureBar: Math.max(fieldInputs.compressionRatio, 0.1),
                    condenserPressureBar: Math.max(fieldInputs.cutoffRatio, 0.05),
                  };
        const result = analyseGasCycle(cycleInput);
        const peak = Math.max(...result.states.map((state) => state.temperatureK));
        setFieldResult({
          summary: [
            ['Thermal efficiency', `${(result.thermalEfficiency * 100).toFixed(2)} %`],
            ['Net work', `${result.netWorkKJPerKg.toFixed(1)} kJ/kg`],
            ['Heat rejected', `${result.heatRejectedKJPerKg.toFixed(1)} kJ/kg`],
            ['Heat supplied', `${result.heatInputKJPerKg.toFixed(1)} kJ/kg`],
            ['Peak temperature', `${peak.toFixed(1)} K`],
          ],
          note: result.notes.join(' '),
        });
      } else if (fieldMode === 'pipe') {
        const result = analysePipeFlow({
          lengthM: fieldInputs.pipeLengthM,
          diameterM: fieldInputs.pipeDiameterMm * 1e-3,
          roughnessMm: fieldInputs.roughnessMm,
          flowM3PerS: fieldInputs.pipeFlowLps / 1000,
          minorLossCoefficient: fieldInputs.minorLossK,
          elevationChangeM: fieldInputs.elevationM,
        });
        setFieldResult({
          summary: [
            ['Velocity', `${result.velocityMperS.toFixed(3)} m/s`],
            ['Reynolds number', result.reynolds.toFixed(0)],
            ['Friction factor', result.frictionFactor.toFixed(5)],
            ['Major / minor loss', `${result.majorLossM.toFixed(2)} / ${result.minorLossM.toFixed(2)} m`],
            ['Total head loss', `${result.totalHeadLossM.toFixed(2)} m`],
            ['Pressure drop', `${(result.pressureDropPa / 1000).toFixed(2)} kPa`],
            ['Hydraulic power', `${result.hydraulicPowerW.toFixed(1)} W`],
          ],
          note: `${result.regime[0].toUpperCase()}${result.regime.slice(1)} regime; water at 20 °C unless the fluid properties are changed in code.`,
        });
      } else {
        const room = analyseRoomAcoustics({
          volumeM3: fieldInputs.roomVolumeM3,
          surfaces: [{ id: 'equivalent surface', areaM2: fieldInputs.roomSurfaceM2, absorptionCoefficient: fieldInputs.absorption }],
        });
        const partition = partitionTransmissionLoss({
          surfaceMassKgPerM2: fieldInputs.partitionMassKgM2,
          frequencyHz: fieldInputs.frequencyHz,
        });
        const summary: Array<[string, string]> = [
          ['Sabine RT60', `${room.sabineRt60S.toFixed(3)} s`],
          ['Eyring RT60', `${room.eyringRt60S.toFixed(3)} s`],
          ['Mean absorption', room.meanAbsorptionCoefficient.toFixed(3)],
          ['Partition TL', `${partition.transmissionLossDb.toFixed(1)} dB at ${fieldInputs.frequencyHz} Hz`],
        ];
        if (Number.isFinite(room.roomConstantM2)) {
          summary.push(['Critical distance', `${criticalDistanceM(room.roomConstantM2).toFixed(2)} m`]);
        }
        setFieldResult({ summary, note: `${room.note} ${partition.note}` });
      }
    } catch (error) {
      setFieldResult(null);
      setFieldError(describeError(error));
    }
  };

  const viewComponents = useMemo<ViewMechanicalComponent[]>(
    () =>
      parts.map(part => ({
        id: part.id,
        name: part.name,
        type: 'structural',
        geometry: {
          type: 'box',
          dimensions: { width: part.dimensions.length, height: part.dimensions.height },
          depth: part.dimensions.width,
          position: { x: part.position[0], y: part.position[1], z: part.position[2] },
          rotation: { x: part.rotation[0], y: part.rotation[1], z: part.rotation[2] },
        },
        material: part.material,
        constraints: part.constraints.fixed
          ? [{ type: 'fixed', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } }]
          : [],
        properties: { mass: part.properties.mass, volume: part.properties.volume },
      })),
    [parts],
  );

  const viewLoads = useMemo(
    () =>
      parts.flatMap(part =>
        part.loads.forces.map(force => ({
          componentId: part.id,
          direction: { x: force.x, y: force.y, z: force.z },
          magnitude: force.magnitude,
        })),
      ),
    [parts],
  );

  const viewSupports = useMemo<MechanicalSupportMarker[]>(
    () =>
      parts.flatMap((part): MechanicalSupportMarker[] => {
        if (part.constraints.fixed) return [{ componentId: part.id, kind: 'fixed' as const }];
        if (part.constraints.pinned) return [{ componentId: part.id, kind: 'pinned' as const }];
        if (part.constraints.roller) return [{ componentId: part.id, kind: 'roller' as const }];
        return [];
      }),
    [parts],
  );

  const viewStress = useMemo(() => {
    if (!showStress || !analysisResult || analysisResult.stress.length === 0) return undefined;
    return Object.fromEntries(analysisResult.stress.map(item => [item.nodeId, item.vonMises]));
  }, [analysisResult, showStress]);

  const updatePartMaterial = (partId: string, materialKey: string) => {
    setParts(current =>
      current.map(part => {
        if (part.id !== partId) return part;
        const material = getMaterial(materialKey);
        return {
          ...part,
          materialKey,
          material,
          properties: { ...part.properties, mass: part.properties.volume * material.density },
        };
      }),
    );
    setAnalysisResult(null);
  };

  const runStructuralAnalysis = (): AnalysisResult => {
    const analysed = parts.map(part => ({ part, result: analysePart(part) }));

    const displacement = analysed.map(({ part, result }) => ({
      nodeId: part.id,
      x: 0,
      y: -result.deflectionM,
      z: 0,
    }));
    const stress = analysed.map(({ part, result }) => {
      const vonMises = result.stressPa / 1e6;
      return { nodeId: part.id, vonMises, principal: [vonMises, 0, 0] as [number, number, number] };
    });
    const strain = analysed.map(({ part, result }) => ({
      nodeId: part.id,
      x: 0,
      y: -result.signedStressPa / part.material.youngsModulus,
      z: 0,
    }));

    // Modal and buckling results belong to the part the user is inspecting; the
    // stress and displacement lists cover every part.
    const modalEntry =
      analysed.find(item => item.part.id === selectedComponent) ?? analysed[0];
    const modalPart = modalEntry
      ? {
          partId: modalEntry.part.id,
          partName: modalEntry.part.name,
          naturalFrequencies: modalEntry.result.naturalFrequenciesHz,
        }
      : { partId: '', partName: 'No part', naturalFrequencies: [] };
    const bucklingEntry = modalEntry
      ? {
          partId: modalEntry.part.id,
          partName: modalEntry.part.name,
          criticalLoad: modalEntry.result.bucklingLoadN,
          mode: 1,
        }
      : { partId: '', partName: 'No part', criticalLoad: 0, mode: 1 };

    const maxStressPa = Math.max(0, ...analysed.map(item => item.result.stressPa));
    const safetyFactors = analysed
      .map(item => item.result.safetyFactor)
      .filter((factor): factor is number => factor !== null && Number.isFinite(factor));
    const safetyFactor = safetyFactors.length > 0 ? Math.min(...safetyFactors) : 0;
    const minYield = Math.min(...parts.map(part => part.material.yieldStrength));
    const enduranceLimit = 0.4 * minYield;
    // Basquin with m = 3 anchored at 10⁶ cycles; below the endurance limit the
    // part is reported at the 10⁹-cycle run-out instead of pretending infinite life.
    const cycles =
      maxStressPa === 0 || maxStressPa <= enduranceLimit
        ? 1_000_000_000
        : Math.max(1, Math.round(1e6 * (enduranceLimit / maxStressPa) ** 3));

    return {
      displacement,
      stress,
      strain,
      modal: modalPart,
      buckling: bucklingEntry,
      fatigue: { cycles, safetyFactor },
    };
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      // Yield to the browser so the running state paints before the solve.
      await new Promise(resolve => setTimeout(resolve, 0));
      setAnalysisResult(analysisType === 'thermal' ? enclosureThermalResult() : runStructuralAnalysis());
    } catch (error) {
      setAnalysisResult(null);
      setAnalysisError(describeError(error));
    } finally {
      setIsAnalyzing(false);
    }
  };

  /*
   * Loading the enclosure also slices the tray and builds the STEP block in
   * memory, so the demo lands on measured fabrication evidence instead of an
   * empty print panel. Neither export downloads a file here; the buttons do.
   */
  const handleLoadEnclosure = () => {
    const enclosureParts = enclosureAssemblyParts();
    setParts(enclosureParts);
    setSelectedComponent('enclosure-floor');
    setMateFixedId('enclosure-floor');
    setMateMovingId('enclosure-left');
    setMateVerdict(null);
    setAnalysisResult(enclosureThermalResult());
    setAnalysisType('thermal');
    runPrintExport(false);
    runStepExport(false, enclosureParts);
  };

  useDemoRequest('mechanical-enclosure', handleLoadEnclosure);

  const handleExportResults = () => {
    if (!analysisResult) return;

    const report = {
      timestamp: new Date().toISOString(),
      analysisType,
      components: parts.map(part => ({
        id: part.id,
        name: part.name,
        material: part.material.name,
        dimensions: part.dimensions,
      })),
      results: analysisResult,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mechanical_analysis_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Build a real assembly in the mechanical engine and export it. The panel's
   * part dimensions map to the engine's width × height × thickness solid, so
   * the STEP block is the same geometry the viewport draws.
   */
  const buildStepExport = (partList: MechanicalPart[] = parts) => {
    const engine = new MechanicalDesignEngine();
    const assembly = engine.createAssembly('folio-mechanical');
    for (const part of partList) {
      const component = engine.createComponent(
        part.kind === 'plate' ? 'enclosure' : 'structural',
        { width: part.dimensions.length, height: part.dimensions.width },
        part.materialKey,
        part.dimensions.height,
      );
      component.position = { x: part.position[0], y: part.position[1] };
      component.rotation = part.rotation[2];
      engine.addComponentToAssembly(assembly.id, component);
    }
    return { step: engine.exportToSTEP(assembly.id), filename: `${assembly.name}.step` };
  };

  /** Export the assembly; the demo builds it without triggering a download. */
  const runStepExport = (download: boolean, partList: MechanicalPart[] = parts) => {
    if (partList.length === 0) {
      setStepStatus({ ok: false, message: 'Load an assembly before exporting STEP.' });
      return;
    }
    try {
      const { step, filename } = buildStepExport(partList);
      if (download) {
        const blob = new Blob([step], { type: 'application/step' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }
      setStepStatus({
        ok: true,
        message: `STEP ${download ? 'ready' : 'validated'}: ${(step.length / 1024).toFixed(1)} KiB AP214 text for ${partList.length} part(s) (${filename}).`,
      });
    } catch (error) {
      setStepStatus({ ok: false, message: describeError(error) });
    }
  };

  const handleExportStep = () => runStepExport(true);

  /**
   * Orthographic third-angle drawing of the selected part: front/top/right
   * views with real millimetre dimensions, a title block and manufacturing
   * notes. Nominal model geometry only — it does not invent tolerances.
   */
  const handleExportDrawing = () => {
    const part = parts.find(candidate => candidate.id === selectedComponent);
    if (!part) {
      setDrawingStatus('Select a part before exporting a drawing.');
      return;
    }
    try {
      const isMetal = /alum|steel|titan|copper|brass|iron|alloy/i.test(part.material.name);
      const svg = buildPartDrawing(
        {
          id: part.id,
          name: part.name,
          dimensions: part.dimensions,
          materialName: part.material.name,
          massKg: part.properties.mass,
        },
        {
          paperSize: 'A3',
          revision: 'A',
          finish: isMetal ? 'AS MACHINED' : 'AS PRINTED',
        },
      );
      const filename = `${part.name.replace(/[^a-z0-9]+/gi, '_')}_drawing.svg`;
      downloadFile(svg, filename, 'image/svg+xml');
      setDrawingStatus(`${filename} — third-angle views, dimensions in millimetres.`);
    } catch (error) {
      setDrawingStatus(describeError(error));
    }
  };

  const selectedComponentData = parts.find(c => c.id === selectedComponent);
  const maxStress = analysisResult && analysisResult.stress.length > 0
    ? Math.max(...analysisResult.stress.map(item => item.vonMises))
    : null;
  const showThermal = analysisType === 'thermal' && analysisResult?.thermal !== undefined;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden bg-card lg:flex-row">
        {/* 3D viewport */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <ThreeCanvas
            components={viewComponents}
            view={view}
            loads={viewLoads}
            showLoads={showLoads}
            supports={viewSupports}
            showSupports={showConstraints}
            stress={viewStress}
            className="h-full"
          />

          {/* Camera presets */}
          <div className="absolute top-4 left-4 flex gap-2">
            {(['front', 'side', 'top', 'iso'] as const).map(mode => (
              <Button
                key={mode}
                variant={view === mode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView(mode)}
                className="capitalize"
              >
                {mode}
              </Button>
            ))}
          </div>

          {/* Analysis status */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Components: {parts.length}</div>
              <div>Analysis: {analysisType}</div>
              <div>Status: {isAnalyzing ? 'Running...' : 'Ready'}</div>
              {maxStress !== null && <div>Max Stress: {maxStress.toFixed(1)} MPa</div>}
            </div>
          </div>
        </div>

        {/* Control panel */}
        <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Mechanical Design</h3>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close mechanical design panel">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Analysis controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label htmlFor="mech-analysis-type" className="block text-xs font-medium text-muted-foreground mb-1">
                    Analysis Type
                  </label>
                  <select
                    id="mech-analysis-type"
                    value={analysisType}
                    onChange={(e) => setAnalysisType(e.target.value as 'static' | 'modal' | 'thermal' | 'fatigue')}
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                  >
                    <option value="static">Static Structural</option>
                    <option value="modal">Modal Analysis</option>
                    <option value="thermal">Thermal Analysis</option>
                    <option value="fatigue">Fatigue Analysis</option>
                  </select>
                </div>

                <Button
                  onClick={handleRunAnalysis}
                  disabled={isAnalyzing}
                  className="w-full flex items-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Run Analysis
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLoadEnclosure}
                  className="w-full flex items-center gap-2"
                >
                  <Box className="w-4 h-4" />
                  Load rectifier enclosure ({enclosureVerdict})
                </Button>

                {analysisError && (
                  <p role="alert" className="text-xs leading-relaxed text-destructive">
                    {analysisError}
                  </p>
                )}

                {analysisResult && (
                  <Button
                    variant="outline"
                    onClick={handleExportResults}
                    className="w-full flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Export Results
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleExportStep}
                  disabled={parts.length === 0}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Assembly STEP
                </Button>
                {stepStatus && (
                  <p
                    role={stepStatus.ok ? 'status' : 'alert'}
                    aria-label="STEP export status"
                    className={`text-xs leading-relaxed ${stepStatus.ok ? 'text-success' : 'text-destructive'}`}
                  >
                    {stepStatus.message}
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={handleExportDrawing}
                  disabled={!selectedComponentData}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Part Drawing (SVG)
                </Button>
                {drawingStatus && (
                  <p role="status" aria-label="Drawing status" className="text-xs leading-relaxed text-muted-foreground">
                    {drawingStatus}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Multiphysics calculators: verified reduced-order solvers. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Multiphysics Solver
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  aria-label="Multiphysics solver"
                  value={fieldMode}
                  onChange={(event) => {
                    setFieldMode(event.target.value as FieldMode);
                    setFieldResult(null);
                    setFieldError(null);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {FIELD_MODES.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {FIELD_MODES.find((mode) => mode.id === fieldMode)?.description}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {fieldMode === 'conduction' && (
                    <>
                      <FieldNumber id="field-length" label="Length (m)" value={fieldInputs.lengthM} onChange={(v) => updateField('lengthM', v)} />
                      <FieldNumber id="field-area" label="Area (mm²)" value={fieldInputs.areaMm2} onChange={(v) => updateField('areaMm2', v)} />
                      <FieldNumber id="field-k" label="k (W/m·K)" value={fieldInputs.conductivity} onChange={(v) => updateField('conductivity', v)} />
                      <FieldNumber id="field-gen" label="Generation (kW/m³)" value={fieldInputs.generationKWm3} onChange={(v) => updateField('generationKWm3', v)} />
                      <FieldNumber id="field-t1" label="Start (°C)" value={fieldInputs.startC} onChange={(v) => updateField('startC', v)} />
                      <FieldNumber id="field-t2" label="End (°C)" value={fieldInputs.endC} onChange={(v) => updateField('endC', v)} />
                    </>
                  )}
                  {fieldMode === 'axial' && (
                    <>
                      <FieldNumber id="field-length" label="Length (m)" value={fieldInputs.lengthM} onChange={(v) => updateField('lengthM', v)} />
                      <FieldNumber id="field-area" label="Area (mm²)" value={fieldInputs.areaMm2} onChange={(v) => updateField('areaMm2', v)} />
                      <FieldNumber id="field-e" label="E (GPa)" value={fieldInputs.youngsGPa} onChange={(v) => updateField('youngsGPa', v)} />
                      <FieldNumber id="field-load" label="End load (N)" value={fieldInputs.loadN} onChange={(v) => updateField('loadN', v)} />
                    </>
                  )}
                  {fieldMode === 'truss' && (
                    <>
                      <FieldNumber id="field-span" label="Span (m)" value={fieldInputs.spanM} onChange={(v) => updateField('spanM', v)} />
                      <FieldNumber id="field-height" label="Height (m)" value={fieldInputs.heightM} onChange={(v) => updateField('heightM', v)} />
                      <FieldNumber id="field-area" label="Member area (mm²)" value={fieldInputs.areaMm2} onChange={(v) => updateField('areaMm2', v)} />
                      <FieldNumber id="field-e" label="E (GPa)" value={fieldInputs.youngsGPa} onChange={(v) => updateField('youngsGPa', v)} />
                      <FieldNumber id="field-load" label="Apex load (N)" value={fieldInputs.loadN} onChange={(v) => updateField('loadN', v)} />
                    </>
                  )}
                  {fieldMode === 'electrostatic' && (
                    <>
                      <FieldNumber id="field-separation" label="Separation (mm)" value={fieldInputs.separationMm} onChange={(v) => updateField('separationMm', v)} />
                      <FieldNumber id="field-plate" label="Plate width (mm)" value={fieldInputs.plateWidthMm} onChange={(v) => updateField('plateWidthMm', v)} />
                      <FieldNumber id="field-er" label="Relative εr" value={fieldInputs.relativePermittivity} onChange={(v) => updateField('relativePermittivity', v)} />
                      <FieldNumber id="field-voltage" label="Voltage (V)" value={fieldInputs.voltage} onChange={(v) => updateField('voltage', v)} />
                    </>
                  )}
                  {fieldMode === 'thermo' && (
                    <>
                      <label className="col-span-2 text-xs text-muted-foreground">
                        Cycle
                        <select
                          aria-label="Thermodynamic cycle"
                          value={cycleId}
                          onChange={(event) => setCycleId(event.target.value as GasCycleId)}
                          className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                        >
                          {GAS_CYCLE_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      {cycleId === 'rankine' ? (
                        <>
                          <FieldNumber id="field-boiler" label="Boiler (bar)" value={fieldInputs.compressionRatio} onChange={(v) => updateField('compressionRatio', v)} />
                          <FieldNumber id="field-condenser" label="Condenser (bar)" value={fieldInputs.cutoffRatio} onChange={(v) => updateField('cutoffRatio', v)} />
                        </>
                      ) : (
                        <>
                          <FieldNumber id="field-cold" label="Cold / inlet (K)" value={fieldInputs.startC} onChange={(v) => updateField('startC', v)} />
                          {(cycleId === 'carnot' || cycleId === 'brayton') && (
                            <FieldNumber id="field-hot" label={cycleId === 'brayton' ? 'Turbine inlet (K)' : 'Hot reservoir (K)'} value={fieldInputs.endC} onChange={(v) => updateField('endC', v)} />
                          )}
                          {(cycleId === 'otto' || cycleId === 'diesel' || cycleId === 'brayton') && (
                            <FieldNumber
                              id="field-ratio"
                              label={cycleId === 'brayton' ? 'Pressure ratio' : 'Compression ratio'}
                              value={fieldInputs.compressionRatio}
                              onChange={(v) => updateField('compressionRatio', v)}
                            />
                          )}
                          {cycleId === 'diesel' && (
                            <FieldNumber id="field-cutoff" label="Cut-off ratio" value={fieldInputs.cutoffRatio} onChange={(v) => updateField('cutoffRatio', v)} />
                          )}
                        </>
                      )}
                    </>
                  )}
                  {fieldMode === 'pipe' && (
                    <>
                      <FieldNumber id="field-pipe-length" label="Length (m)" value={fieldInputs.pipeLengthM} onChange={(v) => updateField('pipeLengthM', v)} />
                      <FieldNumber id="field-pipe-diameter" label="Diameter (mm)" value={fieldInputs.pipeDiameterMm} onChange={(v) => updateField('pipeDiameterMm', v)} />
                      <FieldNumber id="field-pipe-flow" label="Flow (L/s)" value={fieldInputs.pipeFlowLps} onChange={(v) => updateField('pipeFlowLps', v)} />
                      <FieldNumber id="field-pipe-roughness" label="Roughness (mm)" value={fieldInputs.roughnessMm} onChange={(v) => updateField('roughnessMm', v)} />
                      <FieldNumber id="field-pipe-minor" label="Minor K" value={fieldInputs.minorLossK} onChange={(v) => updateField('minorLossK', v)} />
                      <FieldNumber id="field-pipe-elevation" label="Elevation (m)" value={fieldInputs.elevationM} onChange={(v) => updateField('elevationM', v)} />
                    </>
                  )}
                  {fieldMode === 'acoustics' && (
                    <>
                      <FieldNumber id="field-room-volume" label="Room volume (m³)" value={fieldInputs.roomVolumeM3} onChange={(v) => updateField('roomVolumeM3', v)} />
                      <FieldNumber id="field-room-surface" label="Surface (m²)" value={fieldInputs.roomSurfaceM2} onChange={(v) => updateField('roomSurfaceM2', v)} />
                      <FieldNumber id="field-absorption" label="Absorption (0–1)" value={fieldInputs.absorption} step={0.01} onChange={(v) => updateField('absorption', v)} />
                      <FieldNumber id="field-partition-mass" label="Partition (kg/m²)" value={fieldInputs.partitionMassKgM2} onChange={(v) => updateField('partitionMassKgM2', v)} />
                      <FieldNumber id="field-frequency" label="Frequency (Hz)" value={fieldInputs.frequencyHz} onChange={(v) => updateField('frequencyHz', v)} />
                    </>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button onClick={solveField} size="sm" className="flex-1 flex items-center gap-2">
                    <Zap className="w-3 h-3" />
                    Solve
                  </Button>
                  <Button onClick={applySelectedPart} variant="outline" size="sm">
                    Use selected part
                  </Button>
                </div>

                {fieldError && (
                  <p role="alert" className="text-xs leading-relaxed text-destructive">
                    {fieldError}
                  </p>
                )}
                {fieldResult && (
                  <div className="space-y-1 text-xs">
                    {fieldResult.summary.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{label}</span>
                        <span>{value}</span>
                      </div>
                    ))}
                    <p className="pt-1 text-muted-foreground">{fieldResult.note}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Components */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Components</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {parts.map(part => (
                  <button
                    key={part.id}
                    type="button"
                    className={`w-full p-2 text-left rounded cursor-pointer transition-colors ${
                      selectedComponent === part.id
                        ? 'bg-primary/10 border border-primary/20'
                        : 'border border-transparent hover:bg-accent'
                    }`}
                    onClick={() => setSelectedComponent(part.id)}
                  >
                    <div className="font-medium text-sm">{part.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {part.kind} - {part.material.name}
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Assembly mates: closed-form translation only, verified after solving. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Assembly mates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Translation mates solved between part origins. Orientation-only constraints are
                  rejected rather than approximated, and the solved placement is re-checked before it
                  is applied.
                </p>
                <div>
                  <label htmlFor="mate-kind" className="block text-xs font-medium text-muted-foreground mb-1">
                    Mate type
                  </label>
                  <select
                    id="mate-kind"
                    value={mateKind}
                    onChange={(event) => {
                      setMateKind(event.target.value as 'distance' | 'coincident');
                      setMateVerdict(null);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="distance">Distance</option>
                    <option value="coincident">Coincident</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="mate-reference" className="block text-xs font-medium text-muted-foreground mb-1">
                    Reference part
                  </label>
                  <select
                    id="mate-reference"
                    value={mateFixedId}
                    onChange={(event) => {
                      setMateFixedId(event.target.value);
                      setMateVerdict(null);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {parts.map(part => (
                      <option key={part.id} value={part.id}>{part.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="mate-moving" className="block text-xs font-medium text-muted-foreground mb-1">
                    Moving part
                  </label>
                  <select
                    id="mate-moving"
                    value={mateMovingId}
                    onChange={(event) => {
                      setMateMovingId(event.target.value);
                      setMateVerdict(null);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {parts.map(part => (
                      <option key={part.id} value={part.id}>{part.name}</option>
                    ))}
                  </select>
                </div>
                {mateKind === 'distance' && (
                  <FieldNumber
                    id="mate-gap"
                    label="Origin-to-origin gap (mm)"
                    value={mateGapMm}
                    onChange={setMateGapMm}
                  />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCheckMate} className="flex-1">
                    Check mate
                  </Button>
                  <Button size="sm" onClick={handleSolveMate} className="flex-1">
                    Solve &amp; apply
                  </Button>
                </div>
                {mateVerdict && (
                  <p
                    role={mateVerdict.ok ? 'status' : 'alert'}
                    aria-label="Mate verdict"
                    className={`text-xs leading-relaxed ${mateVerdict.ok ? 'text-success' : 'text-destructive'}`}
                  >
                    {mateVerdict.message}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Section sizing: deterministic particle-swarm search. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Section sizing (PSO)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Minimises mass for a solid rectangular cantilever inside a fixed envelope (width
                  2–60 mm, height 10–120 mm). Deterministic seeded swarm; the reported section is
                  re-checked against the closed-form stress and deflection limits.
                </p>
                <div>
                  <label htmlFor="sizing-material" className="block text-xs font-medium text-muted-foreground mb-1">
                    Material
                  </label>
                  <select
                    id="sizing-material"
                    value={sizingMaterialKey}
                    onChange={(event) => {
                      setSizingMaterialKey(event.target.value);
                      setSizingResult(null);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {Object.entries(MATERIALS).map(([key, material]) => (
                      <option key={key} value={key}>{material.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FieldNumber
                    id="sizing-span"
                    label="Span (m)"
                    value={sizingSpanM}
                    step={0.05}
                    onChange={(value) => { setSizingSpanM(value); setSizingResult(null); }}
                  />
                  <FieldNumber
                    id="sizing-load"
                    label="Tip load (N)"
                    value={sizingLoadN}
                    step={50}
                    onChange={(value) => { setSizingLoadN(value); setSizingResult(null); }}
                  />
                  <FieldNumber
                    id="sizing-deflection"
                    label="Deflection limit (mm)"
                    value={sizingDeflectionMm}
                    step={0.5}
                    onChange={(value) => { setSizingDeflectionMm(value); setSizingResult(null); }}
                  />
                  <FieldNumber
                    id="sizing-safety"
                    label="Safety factor"
                    value={sizingSafetyFactor}
                    step={0.1}
                    onChange={(value) => { setSizingSafetyFactor(value); setSizingResult(null); }}
                  />
                  <FieldNumber
                    id="sizing-aspect"
                    label="Max height / width"
                    value={sizingMaxAspect}
                    step={1}
                    onChange={(value) => { setSizingMaxAspect(value); setSizingResult(null); }}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void handleOptimizeSection()}
                  disabled={sizingBusy}
                >
                  {sizingBusy ? 'Searching…' : 'Run sizing search'}
                </Button>
                {sizingError && (
                  <p role="alert" aria-label="Sizing error" className="text-xs text-destructive">
                    {sizingError}
                  </p>
                )}
                {sizingResult && (
                  <div className="space-y-2">
                    <p
                      role={sizingResult.feasible ? 'status' : 'alert'}
                      aria-label="Sizing result"
                      className={`text-xs leading-relaxed ${sizingResult.feasible ? 'text-success' : 'text-destructive'}`}
                    >
                      {sizingResult.feasible
                        ? `Feasible — ${(sizingResult.widthM * 1000).toFixed(2)} × ${(sizingResult.heightM * 1000).toFixed(1)} mm, ${sizingResult.massKg.toFixed(3)} kg.`
                        : 'No feasible section inside the search bounds — widen the envelope or relax the limits.'}
                    </p>
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mass</span>
                        <span>{sizingResult.massKg.toFixed(3)} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stress</span>
                        <span>
                          {(sizingResult.stressPa / 1e6).toFixed(1)} MPa
                          {' '}({(sizingResult.stressUtilization * 100).toFixed(1)}% of allowable)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tip deflection</span>
                        <span>
                          {(sizingResult.deflectionM * 1000).toFixed(2)} mm
                          {' '}({(sizingResult.deflectionUtilization * 100).toFixed(1)}% of limit)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Slenderness</span>
                        <span>
                          {sizingResult.aspectRatio.toFixed(1)}
                          {' '}(limit {sizingMaxAspect})
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Swarm</span>
                        <span>
                          {sizingResult.iterations} iterations
                          {sizingResult.repaired ? ' · repaired to satisfy limits' : ''}
                        </span>
                      </div>
                    </div>
                    {sizingResult.feasible && sizingTarget && (
                      <Button variant="outline" size="sm" className="w-full" onClick={handleApplySection}>
                        Apply to {sizingTarget.name}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* FDM print preparation: real slicing of the enclosure tray. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  Print enclosure (G-code)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Slices the watertight demo tray ({printPart.outerMm.width.toFixed(0)} ×{' '}
                  {printPart.outerMm.depth.toFixed(0)} × {printPart.outerMm.height.toFixed(1)} mm,
                  {' '}{printPart.wallMm.toFixed(1)} mm walls) with triangle–plane intersections,
                  even-odd infill and relative extrusion. Open meshes are reported, never fabricated.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <FieldNumber
                    id="print-layer"
                    label="Layer height (mm)"
                    value={printLayerHeight}
                    step={0.05}
                    onChange={(value) => { setPrintLayerHeight(value); setPrintStatus(null); }}
                  />
                  <FieldNumber
                    id="print-infill"
                    label="Infill (%)"
                    value={printInfill}
                    step={5}
                    onChange={(value) => { setPrintInfill(value); setPrintStatus(null); }}
                  />
                  <FieldNumber
                    id="print-brim"
                    label="Brim loops"
                    value={printBrim}
                    step={1}
                    onChange={(value) => { setPrintBrim(value); setPrintStatus(null); }}
                  />
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={printRaft}
                      onChange={(event) => { setPrintRaft(event.target.checked); setPrintStatus(null); }}
                    />
                    Raft
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={printSkirt}
                      onChange={(event) => { setPrintSkirt(event.target.checked); setPrintStatus(null); }}
                    />
                    Skirt
                  </label>
                </div>
                <Button size="sm" className="w-full" onClick={handleExportPrint}>
                  <Download className="w-3 h-3 mr-1" />
                  Download G-code
                </Button>
                {printStatus && (
                  <p
                    role={printStatus.ok ? 'status' : 'alert'}
                    aria-label="Print status"
                    className={`text-xs leading-relaxed ${printStatus.ok ? 'text-success' : 'text-destructive'}`}
                  >
                    {printStatus.message}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Properties */}
            {selectedComponentData && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Properties</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-2">
                    <div className="flex justify-between">
                      <span>Mass:</span>
                      <span>{selectedComponentData.properties.mass.toFixed(3)} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Volume:</span>
                      <span>{selectedComponentData.properties.volume.toFixed(6)} m³</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Material:</span>
                      <select
                        aria-label={`Material for ${selectedComponentData.name}`}
                        value={selectedComponentData.materialKey}
                        onChange={(event) => updatePartMaterial(selectedComponentData.id, event.target.value)}
                        className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
                      >
                        {Object.entries(MATERIALS).map(([key, material]) => (
                          <option key={key} value={key}>{material.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium mb-1">Loads</div>
                    <div className="text-xs space-y-1">
                      <div>Forces: {selectedComponentData.loads.forces.length}</div>
                      <div>Moments: {selectedComponentData.loads.moments.length}</div>
                      <div>Pressure: {selectedComponentData.loads.pressure} Pa</div>
                      <div>Temperature: {(selectedComponentData.loads.temperature - 273.15).toFixed(1)}°C</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results */}
            {analysisResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-2">
                    {showThermal && analysisResult.thermal ? (
                      <div>
                        <div className="font-medium mb-1">Thermal Analysis</div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Lid temperature:</span>
                            <span>{analysisResult.thermal.lidTempC.toFixed(1)} °C</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Rise above ambient:</span>
                            <span>{analysisResult.thermal.temperatureRise.toFixed(1)} K</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Thermal resistance:</span>
                            <span>{analysisResult.thermal.resistanceKW.toFixed(2)} K/W</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Dissipation:</span>
                            <span>{analysisResult.thermal.dissipationW.toFixed(2)} W</span>
                          </div>
                        </div>
                        <p className="mt-2 text-muted-foreground">{analysisResult.thermal.verdict}</p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="font-medium mb-1">Stress Analysis</div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Max von Mises:</span>
                              <span>{(maxStress ?? 0).toFixed(1)} MPa</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Safety Factor:</span>
                              <span className={
                                analysisResult.fatigue.safetyFactor >= 2
                                  ? 'text-success'
                                  : analysisResult.fatigue.safetyFactor >= 1
                                    ? 'text-warning'
                                    : 'text-destructive'
                              }>
                                {analysisResult.fatigue.safetyFactor.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="font-medium mb-1">Displacement</div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Max Displacement:</span>
                              <span>
                                {(Math.max(0, ...analysisResult.displacement.map(d =>
                                  Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z),
                                )) * 1000).toFixed(3)} mm
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {analysisType === 'modal' && analysisResult.modal.naturalFrequencies.length > 0 && (
                      <div>
                        <div className="font-medium mb-1">
                          Natural Frequencies · {analysisResult.modal.partName}
                        </div>
                        <div className="space-y-1">
                          {analysisResult.modal.naturalFrequencies.slice(0, 3).map((freq, index) => (
                            <div key={index} className="flex justify-between">
                              <span>Mode {index + 1}:</span>
                              <span>{freq.toFixed(1)} Hz</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysisType === 'fatigue' && (
                      <div>
                        <div className="font-medium mb-1">Fatigue Life</div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Predicted cycles:</span>
                            <span>{analysisResult.fatigue.cycles.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Buckling load ({analysisResult.buckling.partName}):</span>
                            <span>{(analysisResult.buckling.criticalLoad / 1000).toFixed(2)} kN</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Display */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Display
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Loads</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowLoads(value => !value)}
                    aria-label={showLoads ? 'Hide loads' : 'Show loads'}
                    aria-pressed={showLoads}
                  >
                    {showLoads ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Constraints</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowConstraints(value => !value)}
                    aria-label={showConstraints ? 'Hide constraints' : 'Show constraints'}
                    aria-pressed={showConstraints}
                  >
                    {showConstraints ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Stress</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowStress(value => !value)}
                    disabled={!analysisResult || analysisResult.stress.length === 0}
                    aria-label={showStress ? 'Hide stress' : 'Show stress'}
                    aria-pressed={showStress}
                  >
                    {showStress ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
