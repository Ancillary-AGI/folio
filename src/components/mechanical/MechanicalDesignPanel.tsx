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
  analyseBeam,
  beamBucklingLoad,
  beamNaturalFrequencies,
  type BeamSupport,
} from '../../lib/mechanical/mechanicalAnalysis';
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
  searchCantileverSection,
  type CantileverSizingResult,
} from '../../lib/optimization/designSearch';
import { GCodeExporter } from '../../lib/3d/gcodeExporter';
import { buildEnclosureTrayMesh } from '../../lib/3d/printableEnclosure';
import { downloadFile } from '../../lib/exportUtils';
import { describeError } from '../../lib/utils';
import type { Material, MechanicalComponent as ViewMechanicalComponent } from '../../types/toolbox';

interface MechanicalDesignPanelProps {
  onClose: () => void;
}

interface PartLoads {
  forces: Array<{ x: number; y: number; z: number; magnitude: number }>;
  moments: Array<{ x: number; y: number; z: number; magnitude: number }>;
  pressure: number;
  temperature: number;
}

interface PartConstraints {
  fixed: boolean;
  pinned: boolean;
  roller: boolean;
  displacement: { x: boolean; y: boolean; z: boolean };
  rotation: { x: boolean; y: boolean; z: boolean };
}

interface MechanicalPart {
  id: string;
  name: string;
  kind: 'beam' | 'plate';
  dimensions: { length: number; width: number; height: number };
  position: [number, number, number];
  rotation: [number, number, number];
  materialKey: string;
  material: Material;
  properties: {
    mass: number;
    volume: number;
    centerOfMass: [number, number, number];
    momentOfInertia: [number, number, number];
  };
  loads: PartLoads;
  constraints: PartConstraints;
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

/** The support a part's constraint flags describe, or `null` when it is unsupported. */
function supportFor(part: MechanicalPart): BeamSupport | null {
  if (part.constraints.fixed) return 'cantilever';
  if (part.constraints.pinned || part.constraints.roller) return 'simply-supported';
  return null;
}

function buildPart(config: {
  id: string;
  name: string;
  kind: 'beam' | 'plate';
  dimensions: { length: number; width: number; height: number };
  position: [number, number, number];
  materialKey: string;
  pressure?: number;
  forces?: PartLoads['forces'];
  constraints: Pick<PartConstraints, 'fixed' | 'pinned' | 'roller'>;
}): MechanicalPart {
  const { length, width, height } = config.dimensions;
  const material = getMaterial(config.materialKey);
  const volume = length * width * height;
  return {
    id: config.id,
    name: config.name,
    kind: config.kind,
    dimensions: config.dimensions,
    position: config.position,
    rotation: [0, 0, 0],
    materialKey: config.materialKey,
    material,
    properties: {
      mass: volume * material.density,
      volume,
      centerOfMass: [...config.position],
      momentOfInertia: [
        (volume * material.density * (width ** 2 + height ** 2)) / 12,
        (volume * material.density * (length ** 2 + height ** 2)) / 12,
        (volume * material.density * (length ** 2 + width ** 2)) / 12,
      ],
    },
    loads: {
      forces: config.forces ?? [],
      moments: [],
      pressure: config.pressure ?? 0,
      temperature: 293.15,
    },
    constraints: {
      ...config.constraints,
      displacement: { x: config.constraints.fixed, y: true, z: config.constraints.fixed },
      rotation: { x: true, y: config.constraints.pinned, z: true },
    },
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

type FieldMode = 'conduction' | 'axial' | 'truss' | 'electrostatic';

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

export default function MechanicalDesignPanel({ onClose }: MechanicalDesignPanelProps) {
  const [enclosureVerdict] = useState(() => buildDemoEnclosure().summary.verdict.split(':')[0]);
  const [parts, setParts] = useState<MechanicalPart[]>(() => [
    buildPart({
      id: 'beam-1',
      name: 'Main Beam',
      kind: 'beam',
      dimensions: { length: 2, width: 0.1, height: 0.1 },
      position: [1, 0, 0],
      materialKey: 'aluminum',
      forces: [{ x: 0, y: -1, z: 0, magnitude: 1000 }],
      constraints: { fixed: true, pinned: false, roller: false },
    }),
    buildPart({
      id: 'plate-1',
      name: 'Support Plate',
      kind: 'plate',
      dimensions: { length: 0.5, width: 0.5, height: 0.02 },
      position: [1, -0.06, 0],
      materialKey: 'aluminum',
      pressure: 10000,
      constraints: { fixed: false, pinned: true, roller: false },
    }),
  ]);
  const [selectedComponent, setSelectedComponent] = useState<string>('beam-1');
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

  const handleExportPrint = () => {
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
      downloadFile(gcode, 'enclosure_tray.gcode', 'text/plain');
      setPrintStatus({
        ok: true,
        message: `G-code ready: ${printPart.outerMm.width.toFixed(0)} × ${printPart.outerMm.depth.toFixed(0)} × ${printPart.outerMm.height.toFixed(1)} mm tray, ${printableLayers} layers${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''}.`,
      });
    } catch (error) {
      setPrintStatus({ ok: false, message: describeError(error) });
    }
  };

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
    const selected = parts.find(part => part.id === 'beam-1');
    if (!material || !selected) {
      setSizingError('The Main Beam and its material must exist before applying a section.');
      return;
    }
    const volume = sizingSpanM * sizingResult.widthM * sizingResult.heightM;
    const mass = volume * material.density;
    setParts(current =>
      current.map(part =>
        part.id !== 'beam-1'
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
      } else {
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
    const analysed = parts.map(part => {
      const support = supportFor(part);
      if (!support) {
        throw new Error(
          `"${part.name}" has no support. Set it to fixed, pinned, or roller before analysing.`,
        );
      }
      const span = part.dimensions.length;
      const transverseForce = part.loads.forces.reduce((sum, load) => sum + load.magnitude, 0);
      const appliedMoment = part.loads.moments.reduce((sum, load) => sum + load.magnitude, 0);
      // Pressure acts on the span × width face, so it is a line load of p·b N/m.
      const distributedLoad = part.loads.pressure * part.dimensions.width;
      const beam = analyseBeam(
        { width: part.dimensions.width, height: span, depth: part.dimensions.height },
        {
          youngsModulus: part.material.youngsModulus,
          yieldStrength: part.material.yieldStrength,
          density: part.material.density,
        },
        { transverseForce, moment: appliedMoment, distributedLoad, span },
        { support },
      );
      return { part, beam, support, span, stressPa: Math.abs(beam.totalStress) };
    });

    const displacement = analysed.map(({ part, beam }) => ({
      nodeId: part.id,
      x: 0,
      y: -beam.deflection,
      z: 0,
    }));
    const stress = analysed.map(({ part, beam }) => {
      const vonMises = Math.abs(beam.totalStress) / 1e6;
      return { nodeId: part.id, vonMises, principal: [vonMises, 0, 0] as [number, number, number] };
    });
    const strain = analysed.map(({ part, beam }) => ({
      nodeId: part.id,
      x: 0,
      y: -beam.totalStress / part.material.youngsModulus,
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
          naturalFrequencies: beamNaturalFrequencies(
            {
              width: modalEntry.part.dimensions.width,
              height: modalEntry.span,
              depth: modalEntry.part.dimensions.height,
            },
            {
              youngsModulus: modalEntry.part.material.youngsModulus,
              yieldStrength: modalEntry.part.material.yieldStrength,
              density: modalEntry.part.material.density,
            },
            modalEntry.support,
            modalEntry.span,
          ),
        }
      : { partId: '', partName: 'No part', naturalFrequencies: [] };
    const bucklingEntry = modalEntry
      ? {
          partId: modalEntry.part.id,
          partName: modalEntry.part.name,
          criticalLoad: beamBucklingLoad(
            {
              width: modalEntry.part.dimensions.width,
              height: modalEntry.span,
              depth: modalEntry.part.dimensions.height,
            },
            {
              youngsModulus: modalEntry.part.material.youngsModulus,
              yieldStrength: modalEntry.part.material.yieldStrength,
              density: modalEntry.part.material.density,
            },
            modalEntry.support,
            modalEntry.span,
          ),
          mode: 1,
        }
      : { partId: '', partName: 'No part', criticalLoad: 0, mode: 1 };

    const maxStressPa = Math.max(0, ...analysed.map(item => item.stressPa));
    const safetyFactors = analysed
      .map(item => item.beam.safetyFactor)
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

  const handleLoadEnclosure = () => {
    setAnalysisResult(enclosureThermalResult());
    setAnalysisType('thermal');
  };

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
  const handleExportStep = () => {
    if (parts.length === 0) return;
    const engine = new MechanicalDesignEngine();
    const assembly = engine.createAssembly('folio-mechanical');
    for (const part of parts) {
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
    const step = engine.exportToSTEP(assembly.id);
    const blob = new Blob([step], { type: 'application/step' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${assembly.name}.step`;
    link.click();
    URL.revokeObjectURL(url);
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
                    {sizingResult.feasible && (
                      <Button variant="outline" size="sm" className="w-full" onClick={handleApplySection}>
                        Apply to Main Beam
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
