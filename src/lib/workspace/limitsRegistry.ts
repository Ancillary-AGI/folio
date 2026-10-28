/**
 * Capability and limits registry.
 *
 * The app claims things on screen all day: a margin is "OK", a route is "clean",
 * a fit is "converged". An engineer reading those claims needs one place that
 * says, for each family of results, **what is computed, with what method, which
 * test pins it, and what the model refuses to cover**. That place is this file.
 *
 * It is data, not prose: `LimitsDialog` renders it, the command palette jumps to
 * it and the tour points at it, so a claim cannot be softened in one surface and
 * quietly widened in another. Two invariants are enforced by tests rather than
 * by care:
 *
 *   • every `validatedBy` path is a real test file in this repo, and
 *   • every workspace mode is named by at least one record.
 *
 * A third rule is editorial: a record that cannot name a method does not get to
 * call itself computed. `method` is the algorithm actually in the source — dense
 * LU with scaled partial pivoting on the MNA matrix, Newton-Raphson with gmin
 * stamping, Durand-Kerner root finding, damped least-squares IK, a Lee/A* routing
 * grid, a thin-fin 2-D thermal balance — because "the app says so" is not a
 * verification argument.
 */
import type { WorkspaceMode } from '../../stores/useAppStore'

export type CapabilityFamilyId =
  | 'circuit'
  | 'board'
  | 'structure'
  | 'motion'
  | 'wave'
  | 'logic'
  | 'control'
  | 'machine'
  | 'firmware'
  | 'agents'
  | 'platform'

export interface CapabilityFamily {
  id: CapabilityFamilyId
  label: string
  description: string
}

export interface CapabilityRecord {
  id: string
  family: CapabilityFamilyId
  /** Short title, as read in the list. */
  title: string
  /** Which workspaces this record speaks for. */
  modes: WorkspaceMode[]
  /** The deliverable: what the code actually produces. */
  computes: string
  /** The numerical or analytical method in the source, named precisely. */
  method: string
  /** What is not modelled, what is refused, and what a result does not prove. */
  notCovered: string[]
  /** Repo-relative test files that pin the behaviour. */
  validatedBy: string[]
  /** Needs a cloud credential to be more than a local contract check. */
  cloudOnly?: boolean
}

export const CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  { id: 'circuit', label: 'Circuit simulation', description: 'DC operating point, transient, AC, noise, statistical, multiphysics and digital analysis of the declared netlist.' },
  { id: 'board', label: 'Board & fabrication', description: 'Netlist-to-board conversion, rules checks, routing, integrity estimates and manufacturing artifacts.' },
  { id: 'structure', label: 'Mechanical & structural', description: 'Beam and frame mechanics, enclosure geometry, printability and machine drawings.' },
  { id: 'motion', label: 'Robotics & mechanisms', description: 'Kinematics, rigid-body dynamics, trajectory replay and task checks.' },
  { id: 'wave', label: 'RF & antennas', description: 'Antenna and transmission-line synthesis, RF two-port characterisation and far-field patterns.' },
  { id: 'logic', label: 'HDL, FPGA & silicon', description: 'RTL subset elaboration, simulation, resource estimation and the SKY130 flow.' },
  { id: 'control', label: 'Control & ML toolbox', description: 'LTI analysis, PID design and tuning routes, and the heuristics the designer drives.' },
  { id: 'machine', label: 'Machines & parts', description: 'Electric-machine operating points plus part ratings, margins, catalogues and power sources.' },
  { id: 'firmware', label: 'Firmware, embedded & HIL', description: 'Code generation, static analysis, flashing, imaging and hardware interface simulation.' },
  { id: 'agents', label: 'Agents & AI', description: 'The tool surface an agent may call, the symbolic verifier and the assistant integrations.' },
  { id: 'platform', label: 'Data & operations', description: 'Version control, projects, collaboration, security telemetry, plugins, twins and compute.' },
]

export const CAPABILITY_RECORDS: readonly CapabilityRecord[] = [
  // ── circuit ────────────────────────────────────────────────────────────────
  {
    id: 'circuit-dc',
    family: 'circuit',
    title: 'DC operating point',
    modes: ['schematic', 'simulation'],
    computes: 'Node voltages, branch currents and per-device bias points for the declared netlist, with an explicit convergence report and the implausible nodes named.',
    method:
      'Modified nodal analysis into one dense matrix solved by LU with scaled partial pivoting. Nonlinear devices are iterated by Newton-Raphson: a gmin conductance on every node diagonal, companion models rebuilt from the previous iterate, SPICE-style forward-bias step limiting on junctions, and a warm start carried from the previous transient step. Junctions are full Gummel-Poon, MOSFETs level-1 Shichman-Hodges with body effect and reverse mode, op-amps a three-stage macromodel with GBW pole, slew limit and rail dropout; all Jacobians are analytic, not finite differences.',
    notCovered: [
      'Board-scale nets: a few hundred unknowns. There is no sparse or iterative Krylov solver, so a million-node IC netlist is out of scope rather than merely slow.',
      'Models are transcribed from published reference equations and the bundled vendor catalogue. No foundry model certification is claimed.',
      'A topology that stays singular on every pass returns no solution at all; it is never reported as a solved 0 V answer.',
      'The supported .model subset is declared by the parser: .subckt, .include and .lib are reported as unsupported, never silently folded into a model.',
    ],
    validatedBy: [
      'src/lib/simulation/spiceEngine.test.ts',
      'src/lib/simulation/semiconductors.test.ts',
      'src/lib/simulation/dcSweep.test.ts',
      'src/lib/simulation/modelLibrary.test.ts',
      'src/lib/simulation/netlistBuilder.test.ts',
    ],
  },
  {
    id: 'circuit-transient',
    family: 'circuit',
    title: 'Transient analysis',
    modes: ['simulation'],
    computes: 'Time-domain waveforms for every declared source and probe, with the integration method, step plan and startup mode recorded on the run.',
    method:
      'Backward Euler (default: first order, monotone, unconditionally stable), trapezoidal (second order, preserves LC ringing) or Gear/BDF2 (second order, A-stable, damps high-frequency numerical ringing). Startup is always backward Euler — one step for trapezoidal, two for BDF2 — and repeated after any step-size change; coupled inductors use the backward-Euler 2x2 inverted stamp and transmission lines the exact Branin travelling-wave model.',
    notCovered: [
      'Gear is fixed at order 2; there is no variable-order BDF.',
      'A stiff step the guards reject is reported as non-convergence. Tolerances are never quietly relaxed to produce a curve.',
      'Transmission lines are modelled lossless; a lossy line is not approximated by an RLC ladder.',
      'Refused inputs (infinite stop time, zero point budget, infinite AC stop frequency) fail with a note instead of collapsing onto a duplicated point.',
    ],
    validatedBy: [
      'src/lib/simulation/solverGuards.test.ts',
      'src/lib/simulation/solver-robustness.test.ts',
      'src/lib/simulation/transformerMutual.test.ts',
      'src/lib/simulation/transmissionLine.test.ts',
      'src/lib/simulation/playback.test.ts',
      'src/__tests__/simulationPanel.test.tsx',
    ],
  },
  {
    id: 'circuit-ac-noise',
    family: 'circuit',
    title: 'AC sweep and noise',
    modes: ['simulation'],
    computes: 'Magnitude and phase versus frequency, and an integrated output-noise PSD with RMS over the swept band plus the list of excluded noisy devices.',
    method:
      'Small-signal complex network stamped at each omega, linearised about the converged DC point wherever a device is bias-dependent. Noise uses the adjoint (transposed) network method, so one solve per frequency covers every source: 4kT/R thermal and 2q|Id| shot, integrated trapezoidally over frequency.',
    notCovered: [
      'The reported figure is named thermal+diode noise, never total. Transistor, switch and op-amp noise needs parameters these models do not carry, and every present-but-unmodelled noisy device is returned in excludedSources with a reason.',
      'A purely linear circuit with an indeterminate DC bias is solved at zero bias and says so in the result.',
      'A singular AC network still fails rather than returning a curve.',
      'A partial noise sum presented as a total is treated as a test failure even when the arithmetic is right.',
    ],
    validatedBy: [
      'src/lib/simulation/noise.test.ts',
      'src/lib/simulation/independentReferences.test.ts',
      'src/lib/simulation/goldenVectors.test.ts',
    ],
  },
  {
    id: 'circuit-statistical',
    family: 'circuit',
    title: 'Monte Carlo spread and bench correlation',
    modes: ['simulation'],
    computes: 'Mean and plus/minus-3-sigma envelope of every signal across perturbed values, and a Verified / Not verified verdict against captured bench samples.',
    method:
      'A real sweep: each sample re-solves the circuit with the same engine a nominal run uses, values perturbed by the declared tolerance band through a seeded PRNG, statistics accumulated one-pass Welford. Correlation linearly interpolates each bench sample onto the predicted grid and tests it against that envelope.',
    notCovered: [
      'Parts with no declared tolerance stay exact and are reported as unperturbed, not given an assumed spread.',
      'A seeded sample set is a design-exploration estimate, not a certified production yield.',
      'Anything that cannot be correlated is a typed failure — bands only form where mean and envelope share a grid, otherwise the signal is listed as gridMismatch; an unknown or off-grid sample is uncovered and fails.',
    ],
    validatedBy: [
      'src/lib/simulation/monteCarlo.test.ts',
      'src/lib/simulation/benchCorrelation.test.ts',
    ],
  },
  {
    id: 'circuit-digital',
    family: 'circuit',
    title: 'Digital and mixed-signal simulation',
    modes: ['simulation', 'hdl'],
    computes: 'Multi-state logic waveforms with real propagation delay and sequential state, plus a mixed-signal pass that couples digital transitions into the analog solve and back.',
    method:
      'Discrete-event simulation with four states (0, 1, X, Z), inertial propagation delay per gate and edge-triggered flip-flops; same-timestamp events run in insertion order and clock edges are seeded before stimuli, so a data/clock race resolves by documented convention. Mixed-signal is one forward pass: digital transitions become a PWL source in the analog net, analog probes are thresholded at vdd/2 into a timeline.',
    notCovered: [
      'X propagates rather than being guessed: an AND with one X input and no 0 input stays X.',
      'Setup/hold violation detection and transistor-level contention are not modelled.',
      'An unmodelled construct, a combinational loop that will not settle, or a runaway event storm returns success: false.',
      'Mixed-signal is a single forward pass, not a fixed-point co-simulation; probe transitions are not written back into the digital deck, so no converged closed loop is claimed.',
      'The deck parser raises a named error with the line number for any unrecognised line; nothing is dropped silently.',
    ],
    validatedBy: [
      'src/lib/simulation/digitalLogic.test.ts',
      'src/lib/simulation/digitalNetlistParser.test.ts',
      'src/lib/simulation/mixedSignal.test.ts',
    ],
  },
  {
    id: 'circuit-measure',
    family: 'circuit',
    title: 'Probes, scope metrics and waveform summaries',
    modes: ['simulation'],
    computes: 'Node-voltage and device-current probe series, Vpp/RMS/mean/frequency/duty plus V.I power and efficiency, and compact statistics for agent reading.',
    method:
      'Probes are derived from the solved solution, never stamped as a device. Scope metrics integrate by trapezoid with adaptive-grid weighting; summaries take extrema per bucket when decimated.',
    notCovered: [
      'An unresolvable probe reference yields value: null with a message, never a zero.',
      'Empty or mismatched series fail loudly instead of producing a plausible number.',
      'Nothing is smoothed or extrapolated, so a decimated trace must not be passed to a checker looking for a spike.',
    ],
    validatedBy: [
      'src/lib/simulation/probes.test.ts',
      'src/lib/simulation/scopeAnalysis.test.ts',
      'src/lib/simulation/formatEngineering.test.ts',
    ],
  },
  {
    id: 'circuit-multiphysics',
    family: 'circuit',
    title: 'Reduced-order multiphysics',
    modes: ['simulation', 'mechanical', 'pcb'],
    computes: 'Steady heat-conduction fields, 1-D axial bar and 2-D pin-jointed truss displacements and reactions, and 2-D electrostatic potential fields with a reported residual.',
    method:
      'Finite differences for the thermal and potential fields, direct stiffness for the bar and truss, all reusing the same dense LU solver as the circuit analyser and reporting the genuine linear residual.',
    notCovered: [
      'Verified reduced-order solvers, not a general 3-D FEM suite.',
      'No contact, no plasticity, no frequency response.',
      'Deterministic by construction: an earlier version of this module returned random node voltages, iteration counts and timings. That behaviour is gone and the tests pin it.',
    ],
    validatedBy: [
      'src/lib/simulation/multiphysics.test.ts',
      'src/lib/mechanical/structural.test.ts',
    ],
  },
  {
    id: 'circuit-verification',
    family: 'circuit',
    title: 'Solver verification anchors',
    modes: ['simulation'],
    computes: 'The evidence the solver is trusted against: closed-form reference circuits, checked-in golden decks, and empirical convergence-order measurements.',
    method:
      'Independent expected answers (Ebers-Moll with Early, square-law FET, RC exponential) computed with none of the solver code paths — no Newton, no matrix, no stamps. Golden decks replay per device family against expected files at real engineering tolerances (1 %/1 mV bias, 2 %/5 mV transient). Robustness suites measure each method order empirically: backward Euler O(dt), trapezoidal and BDF2 O(dt^2).',
    notCovered: [
      'The reference simulator is not installed on any machine this repo builds on, so textbook closed forms stand in for it. The solver must land within tolerance of the textbook answer while solving a richer model — that gap is the honest part.',
      'Expected values come from closed-form circuit and control theory, never from recorded output. There is no regen mode and no external simulator call.',
      'Tolerances are engineering tolerances, not bit equality.',
      'Fuzz and robustness tests prove the solver cannot crash or silently return a non-finite answer — not that any given answer is physically right.',
    ],
    validatedBy: [
      'src/lib/simulation/independentReferences.test.ts',
      'src/lib/simulation/goldenVectors.test.ts',
      'src/lib/simulation/solver-robustness.test.ts',
      'src/lib/simulation/benchCorrelation.test.ts',
    ],
  },
  // ── board ──────────────────────────────────────────────────────────────────
  {
    id: 'board-sch-to-pcb',
    family: 'board',
    title: 'Schematic to board conversion and interchange',
    modes: ['convert', 'schematic', 'pcb'],
    computes: 'A placed board — auto-sized outline, resolved layer stack, parts with IPC-derived footprints and nets — plus KiCad and EAGLE interchange files.',
    method:
      'Netlist extraction with terminal-order remap, footprint lookup in the order exact id, then name, then family category, emitting the canonical board the editor, DRC, 3-D view and fab export all consume. Interchange readers parse s-expression and XML into the same shape.',
    notCovered: [
      'Interchange scope is deliberately narrow and fail-loud: two-terminal R, C, L, D, V and I parts with numeric pin ids. A transistor netlist is rejected rather than silently reduced to its first two terminals.',
      'No binary .kicad_pcb and no EAGLE board layout; malformed s-expressions, pin-less components, part-less pinrefs and empty sheets are errors.',
      'A part with no resolvable footprint is reported as unknown geometry; it is not dropped or drawn as a generic box.',
      'Conversion places parts; it does not choose the mechanical envelope or connector positions.',
    ],
    validatedBy: [
      'src/lib/schematicToPcb/schematicToPcbConverter.test.ts',
      'src/lib/manufacturing/kicadNetlist.test.ts',
      'src/lib/manufacturing/eagleSchematic.test.ts',
      'src/lib/simulation/netlistInterchange.test.ts',
      'src/__tests__/schematicToPcbPanel.test.tsx',
    ],
  },
  {
    id: 'board-rules',
    family: 'board',
    title: 'ERC and DRC',
    modes: ['schematic', 'pcb', 'convert'],
    computes: 'Electrical rule findings on the net graph and geometry rule findings on the routed board, each naming the offending object.',
    method:
      'ERC classifies unconnected pins by declared pin type (nc pins are skipped) and reports each physical problem exactly once: one violation per multi-driver net, one per power/ground short, with nets derived from wires on wire-only sheets. DRC uses exact axis-aligned and circle geometry, oval pads bounded by their box, and treats an empty layer set as all layers.',
    notCovered: [
      'DRC is a pre-fabrication gate, not a foundry CAM approval, and the fab-profile gate implements one vendor profile only; another fab is refused rather than approximated.',
      'No field solver: silkscreen legibility, etch asymmetry and copper balance are not checked.',
      'Schematic cross-sheet imports reject duplicate reference designators, because two R1 would silently merge into one device.',
    ],
    validatedBy: [
      'src/lib/manufacturing/drc.test.ts',
      'src/lib/manufacturing/erc.test.ts',
      'src/lib/simulation/multiSheet.test.ts',
      'src/lib/geometry/distance.test.ts',
    ],
  },
  {
    id: 'board-routing',
    family: 'board',
    title: 'Autorouting and controlled structures',
    modes: ['pcb', 'convert'],
    computes: 'Trace and via geometry per net — differential pairs, BGA fanout, DDR and HDI patterns — as the canonical copper the editor, 3-D view and exports draw.',
    method:
      'Lee breadth-first and bidirectional A* hybrid on a per-layer grid, cell size the conservative max of minimum width and minimum spacing, nets ordered by a Manhattan-distance minimum spanning tree, a via penalty charged for layer changes, and routed cells marked as obstacles afterwards. Pair and DDR rules measure skew and length from the routed polylines.',
    notCovered: [
      'No rip-up and re-route: a later net that cannot find a path fails instead of evicting an earlier route, and stays visibly unrouted.',
      'The Manhattan heuristic approximates 45-degree routes.',
      'HDI routing is a single-layer blocked-cell grid; layer changes are not modelled there, and a microvia that would span more than adjacent layers is refused in favour of a buried or plated through via.',
      'A declared pair impedance is the intent: the geometry that delivers it is checked, not field-solved, and converting skew to time needs the effective permittivity the pair actually rides over.',
      'IBIS parsing is the type and section scanner; no buffer transient is simulated.',
    ],
    validatedBy: [
      'src/lib/manufacturing/autorouter.test.ts',
      'src/lib/manufacturing/diffPair.test.ts',
      'src/lib/manufacturing/bgaFanout.test.ts',
      'src/lib/manufacturing/ddrRouting.test.ts',
      'src/lib/manufacturing/hdiRouting.test.ts',
      'src/lib/manufacturing/stackup.test.ts',
    ],
  },
  {
    id: 'board-integrity',
    family: 'board',
    title: 'Signal, power integrity and EMC',
    modes: ['pcb'],
    computes: 'Reflection coefficients and ringing with a multi-reflection lattice diagram and eye, stackup impedances solved for width, PDN pour and decoupling figures, and a radiated-emissions estimate at 3 m.',
    method:
      'Closed-form physics with no fitted constants: Gamma = (ZL - Z0)/(ZL + Z0) with the lattice built from the reflections, microstrip and stripline impedance solved from the declared stackup, and EMC from the textbook small-loop and Hertzian-dipole far fields with common-mode current defaulting to the 1 percent rule of thumb and overridable by the caller.',
    notCovered: [
      'The eye deliberately excludes crosstalk, random jitter, duty-cycle distortion, driver nonlinearity and IBIS V-T behaviour — all of which need an electromagnetic or transistor-level model this module does not have.',
      'Crosstalk is not estimated at all: doing it credibly needs coupled-line geometry and terminations the inputs do not carry.',
      'EMC output is a design-margin estimate, not a chamber measurement.',
      'A failure carries success: false and the reason instead of a curve.',
    ],
    validatedBy: [
      'src/lib/manufacturing/signalIntegrity.test.ts',
      'src/lib/manufacturing/powerIntegrity.test.ts',
      'src/lib/manufacturing/stackup.test.ts',
      'src/lib/emc/emcSimulation.test.ts',
    ],
  },
  {
    id: 'board-thermal',
    family: 'board',
    title: 'Board thermal solution',
    modes: ['pcb', 'preview3d', 'dashboard'],
    computes: 'Steady temperature fields over the board with peak, gradient and hot-spot summary, and a transient board temperature trace with convergence from the measured step change.',
    method:
      'Steady state discretises the thin-plate heat equation (k times laplacian T, plus volumetric generation, minus 2h over t times the temperature above ambient) on a uniform grid with adiabatic edges, rearranged so every coefficient stays positive; face convection is folded in as the standard thin-fin term, which is why thickness matters in a 2-D model. The transient path is a lumped-capacitance solve with convection, radiation and conduction through substrate and declared pours, its explicit Euler step subdivided to stay below the stability limit. The WebGPU path reuses the same prepared coefficients and summariser as the CPU reference.',
    notCovered: [
      'Not CFD and not 3-D thermal FEA; through-thickness gradient is represented by the 2h/t term, not solved.',
      'Copper anisotropy is averaged into an effective in-plane conductivity.',
      'The GPU path must be Jacobi rather than the CPU path in-place SOR, and float32 storage means it assesses convergence at 1 mK rather than 1 uK; the fallback device reports null and the CPU or Worker path runs with the same physics.',
      'Convergence is reported from the actual maximum temperature change per step, never assumed.',
    ],
    validatedBy: [
      'src/lib/pcb/thermalAnalysis.test.ts',
      'src/lib/acceleration/thermalGrid.test.ts',
      'src/lib/acceleration/webgpuThermal.test.ts',
      'src/lib/acceleration/acceleratedSimulation.test.ts',
    ],
  },
  {
    id: 'board-3d',
    family: 'board',
    title: 'Board 3-D view and mesh export',
    modes: ['preview3d'],
    computes: 'A three-dimensional board scene and STL/OBJ meshes built from the routed layout — outline, copper layers, soldermask, pads breaking through, vias and footprint bodies.',
    method: 'One scene geometry builder shared by the renderer and the exporters, so the picture and the mesh come from the same canonical board model rather than a separate demo slab.',
    notCovered: [
      'A geometry preview and mesh exporter, not an electromagnetic, thermal or mechanical co-solve.',
      'Every warning names the element falling outside the outline instead of silently clamping it.',
      'Degenerate face normals are excluded from STL rather than replaced by a tidy (0,0,1) lie about the geometry.',
    ],
    validatedBy: [
      'src/lib/pcb/pcb3dModel.test.ts',
      'src/lib/pcb/pcbScene.test.ts',
      'src/lib/3d/exporters.test.ts',
      'src/lib/3d/framing.test.ts',
      'src/__tests__/circuit3DViewer.test.tsx',
    ],
  },
  {
    id: 'board-fab-export',
    family: 'board',
    title: 'Fabrication package and STEP geometry',
    modes: ['pcb', 'bom'],
    computes: 'A fab package — top and bottom copper films, masks, silk, Excellon drill, centroid file — behind a fab-profile DRC gate, plus BOM roll-ups and enclosure STEP.',
    method: 'Deterministic writers over the canonical layout, with drill emitted as drill rather than as Gerber, and a resolved 1 oz vendor profile.',
    notCovered: [
      'Fail-loud by design: a component with no resolvable footprint, an undefined pad, or copper on an inner layer is a violation, never a guess — this package has no inner-layer film to put it on.',
      'The export never claims a package that DRC refuses; it returns a refused flag instead.',
      'STEP here is plain text with no kernel behind it, so every solid is a faceted CLOSED_SHELL: boxes as four-point polygons and holes as N-gon prisms.',
      'BOM cost and lifecycle status are the values declared in the catalogue; a part with no declared price is unpriced, never zero.',
    ],
    validatedBy: [
      'src/lib/manufacturing/fabExport.test.ts',
      'src/lib/manufacturing/stepGeometry.test.ts',
      'src/lib/manufacturing/enclosureStep.test.ts',
      'src/lib/exportUtils.test.ts',
      'src/__tests__/bomPanel.test.tsx',
    ],
  },
  // ── structure ──────────────────────────────────────────────────────────────
  {
    id: 'structure-beams',
    family: 'structure',
    title: 'Beam, frame and section sizing',
    modes: ['mechanical'],
    computes: 'Deflection, bending and shear stress, section properties, column buckling load and pass/fail against the declared allowable, plus an optimised section for a load case.',
    method:
      'Closed-form Euler-Bernoulli, shaft and column relations, cross-checked against a 1-D direct-stiffness finite-element solver written from the textbook equations independently of the closed forms, so the two never agree by construction. Sizing is a particle swarm over width and height under stress, deflection and slenderness constraints, and the winner is re-checked against the closed forms before it is called feasible.',
    notCovered: [
      '1-D members and 2-D trusses: no 3-D FEA, no contact, no post-buckling path.',
      'A non-positive modulus, length or area throws, and an FEM system that cannot be solved reports that instead of returning a zero-filled displacement vector.',
      'The optimiser returns the best point inside its bounds and budget, not a proof of minimum mass; a grid larger than the candidate budget is sampled at evenly spaced points and the result says so.',
      'Material data is the declared temper table, not a generic average; fatigue and creep are not extrapolated.',
    ],
    validatedBy: [
      'src/lib/mechanical/structural.test.ts',
      'src/lib/mechanical/mechanicalAnalysis.test.ts',
      'src/lib/optimization/designSearch.test.ts',
      'src/lib/optimization/evolutionaryOptimization.test.ts',
      'src/__tests__/mechanicalDesignPanel.test.tsx',
    ],
  },
  {
    id: 'structure-print',
    family: 'structure',
    title: 'Printability and G-code',
    modes: ['mechanical', 'preview3d'],
    computes: 'Overhang, thin-wall and build-volume-fit metrics from the actual mesh, a watertight enclosure mesh, and a slice FDM toolpath.',
    method:
      'A real triangle-plane intersection per layer, segments chained into closed loops, loops oriented by nesting depth (outer counter-clockwise, holes clockwise) and rectilinear infill clipped with the even-odd rule; solid shell layers versus infill density are separate, and the build direction is mapped from Y-up to printer Z.',
    notCovered: [
      'One perimeter path per loop — no wall offsetting — and no support generation.',
      'FDM only: enabling supports or choosing SLA/SLS throws instead of emitting G-code that cannot be printed as intended.',
      'An open mesh chain is reported as open, not stitched into a watertight-looking path.',
      'Printability metrics are geometric; they say nothing about a specific printer, filament or slicer profile.',
    ],
    validatedBy: [
      'src/lib/3d/gcodeExporter.test.ts',
      'src/lib/3d/printableEnclosure.test.ts',
      'src/lib/3d/threeManager.test.ts',
      'src/lib/robotics/manufacturability.test.ts',
    ],
  },
  {
    id: 'structure-assembly',
    family: 'structure',
    title: 'Assemblies, mechanisms and machine drawings',
    modes: ['mechanical', 'pcb', 'robotics'],
    computes: 'Multi-body assembly geometry with mate and clearance findings, mechanism STEP export, and third-angle orthographic drawing SVG for parts and assemblies.',
    method: 'Closed-form translation solvers for the declared mates, transform composition over the parts, and a projection and dimensioning pass that lays out the drawing sheet and title block.',
    notCovered: [
      'Dimensions on a drawing are nominal model values: the drawing never claims tolerances, finishes or materials the model does not carry.',
      'Mechanism STEP approximates every link as a box of the measured section, so it is a different solid from the STL mesh path — the two share a pose, not a byte-for-byte geometry.',
      'Export is refused when the manufacturability gate fails.',
      'No GD&T datum analysis and no tolerance stack-up certification.',
    ],
    validatedBy: [
      'src/lib/mechanical/assembly.test.ts',
      'src/lib/mechanical/partDrawing.test.ts',
      'src/lib/robotics/mechanismExport.test.ts',
      'src/lib/geometry/distance.test.ts',
    ],
  },
  // ── motion ─────────────────────────────────────────────────────────────────
  {
    id: 'motion-kinematics',
    family: 'motion',
    title: 'Kinematics and inverse kinematics',
    modes: ['robotics'],
    computes: 'Forward kinematics for the declared DH chain, joint positions for a requested tool pose, and joint-space previews.',
    method:
      'Denavit-Hartenberg frames with 4x4 row-major transforms and an analytic geometric Jacobian; inverse kinematics is damped least squares with adaptive damping, step limiting and joint-limit clamping, taking orientation from the actual rotation matrix. On failure it retries a deterministic distance-ordered seed set, so a reachable target is not missed for want of a good initial guess. No randomness is involved.',
    notCovered: [
      'An unreachable target reports the residual it reached rather than claiming the pose.',
      'A move whose velocity or acceleration limits cannot be met says so instead of silently overshooting.',
      'No collision-aware or time-optimal planning: a solution is geometric, not proven executable by a real arm.',
      'A malformed transform or state vector throws; no helper invents an answer for an input it cannot represent.',
    ],
    validatedBy: [
      'src/lib/robotics/serialManipulator.test.ts',
      'src/lib/robotics/advancedRoboticsFk.test.ts',
      'src/lib/robotics/advancedRoboticsGeometry.test.ts',
      'src/lib/mechanical/kinematics.test.ts',
    ],
  },
  {
    id: 'motion-dynamics',
    family: 'motion',
    title: 'Rigid-body dynamics and integration',
    modes: ['robotics'],
    computes: 'Mass matrix M(q), gravity torque, Coriolis and centrifugal torque, joint torques and mechanical energy for a serial revolute/prismatic chain, plus a per-joint swing model and the integrators that advance them.',
    method:
      'Jacobian-based assembly of M(q) with Coriolis as M-dot*q-dot minus half the gradient of q-dot transpose M q-dot, and a reported mass-matrix condition ratio. The per-joint model is the physical pendulum, advanced by a symplectic Euler integrator. Integrators are held to closed forms (the pendulum elliptic-integral period, A*cos(wt+phi), T0*exp(-kt), half g t squared) and their convergence order is measured empirically.',
    notCovered: [
      'Friction, motor dynamics and flexible-body effects are not modelled.',
      'The per-joint model is deliberately a single-joint solve, not a coupled multibody solve, and the UI labels it as such; a y axis yields a free rotor.',
      'Unsupported joint types and malformed state vectors raise an error instead of returning a stable-looking trace.',
      'A non-positive mass, dimension or step throws, a non-finite state is rejected naming the step, and a length mismatch is refused.',
      'The integrators never agree with the reference by construction — agreement is earned at the tolerance.',
    ],
    validatedBy: [
      'src/lib/robotics/advancedRoboticsDynamics.test.ts',
      'src/lib/robotics/jointDynamics.test.ts',
      'src/lib/robotics/timeIntegration.test.ts',
      'src/lib/mechanical/dynamics.test.ts',
    ],
  },
  {
    id: 'motion-task',
    family: 'motion',
    title: 'Trajectory, collision and smoothness',
    modes: ['robotics'],
    computes: 'Planned joint profiles (linear, cubic, quintic, trapezoidal), a replayed task path, collision findings against declared obstacles, and a dimensionless jerk score.',
    method:
      'Replay samples the planned joint-space profile from the planned start pose, or integrates declared joint velocities from the current pose; with no planned move the current pose is held. Task collision tests the tool point against each obstacle box, sphere or cylinder; the service-level chain check uses conservative oriented-bounding-box overlap as a broad phase. Smoothness is jerk normalised to be sample-density independent.',
    notCovered: [
      'Task checking does not sweep the links or the tool between samples, so a fast move can pass through a thin obstacle between two waypoints — raise the sample count when that matters.',
      'A recording shorter than four samples reports no smoothness value at all; too short to estimate jerk is not the same as clean.',
      'Box-level overlap is the only contact model, so narrow-phase contact is not reported rather than invented.',
      'Non-monotonic timestamps, out-of-limit or non-finite waypoints and empty tasks are rejected.',
      'The service kinematics are a planar DH chain.',
    ],
    validatedBy: [
      'src/lib/robotics/taskCheck.test.ts',
      'src/lib/robotics/roboticsSimulation.test.ts',
      'src/lib/robotics/advancedRoboticsTraj.test.ts',
      'src/lib/robotics/advancedRoboticsGeometry.test.ts',
    ],
  },
  // ── wave ───────────────────────────────────────────────────────────────────
  {
    id: 'wave-antenna',
    family: 'wave',
    title: 'Antenna synthesis and far field',
    modes: ['rf'],
    computes: 'Radiation resistance, integrated directivity, beamwidths, a sampled far-field pattern and a resistive feed match for wire and patch geometries.',
    method:
      'A thin-wire radiation-resistance kernel and a two-slot aperture-conductance patch model evaluated from the declared geometry, with directivity integrated over the sampled pattern.',
    notCovered: [
      'The module emits machine-readable not-modelled codes instead of blank cells or invented numbers: the thin-wire reactance kernel (needs wire radius) is not implemented, so only radiation resistance is computed; bandwidth needs cavity quality factors that are not modelled; true VSWR needs the complex input impedance; and an azimuthally symmetric wire pattern has no separate H-plane lobe.',
      'Results carry named assumptions the UI must show as assumptions: efficiency is 100 by loss-free assumption so gain equals integrated directivity, the patch edge resistance drops the mutual slot conductance and under-reports for electrically short patches, and with no reactance modelled the match is not verified over frequency.',
      'The reported impedance is a real radiation resistance only; it is not a matched-50-ohm claim, and resistance at a feed-current null is refused instead of returned as infinity.',
      'Ground plane, enclosure and body loading are not solved.',
    ],
    validatedBy: [
      'src/lib/rf/antennaDesign.test.ts',
      'src/lib/rf/rfDesign.test.ts',
    ],
  },
  {
    id: 'wave-rf-circuit',
    family: 'wave',
    title: 'RF circuit and transmission-line characterisation',
    modes: ['rf', 'simulation'],
    computes: 'Cascaded S-parameter two-ports, gain and noise-figure chains, matching and ladder element synthesis, and microstrip impedance and delay.',
    method: 'Signal-flow cascade arithmetic over the declared blocks, with matching and ladder values solved from the target impedance rather than read from a rule-of-thumb table.',
    notCovered: [
      'Noise figure is NaN when the model does not define it; a missing number is not filled with a typical device.',
      'A circuit with no design metadata cannot be characterised and throws; so does a request for an element the circuit does not contain, or an active element inside a passive ladder.',
      'An oscillator is refused rather than modelled as a two-port.',
      'Gain and bandwidth targets the wire model cannot reach are rejected instead of reported as met.',
    ],
    validatedBy: [
      'src/lib/rf/rfCircuitDesign.test.ts',
      'src/lib/simulation/transmissionLine.test.ts',
    ],
  },
  // ── logic ──────────────────────────────────────────────────────────────────
  {
    id: 'logic-hdl',
    family: 'logic',
    title: 'Verilog / VHDL subset and simulation',
    modes: ['hdl', 'fpga'],
    computes: 'Parse, elaborate to a gate-level netlist and simulate the supported RTL subset.',
    method:
      'Structural parsers for a declared Verilog subset (module header, ports, wire and reg declarations, then gate elaboration) and a VHDL synthesizable subset (entity and architecture with AND, OR, NAND, NOR, XOR, NOT, BUF) elaborating into the same runnable digital netlist the discrete-event kernel simulates.',
    notCovered: [
      'Only the declared subset. Unmapped ports and unsupported constructs fail with the line number instead of being silently ignored.',
      'No timing annotation and no vendor synthesis: a passing simulation proves the modelled logic, not the fabricated part.',
    ],
    validatedBy: [
      'src/lib/fpga/verilogSubset.test.ts',
      'src/lib/fpga/vhdlSubset.test.ts',
      'src/lib/simulation/digitalLogic.test.ts',
      'src/__tests__/hdlEditor.test.tsx',
    ],
  },
  {
    id: 'logic-ic',
    family: 'logic',
    title: 'SKY130 IC flow',
    modes: ['icdesign'],
    computes: 'Gate mapping onto the bundled SKY130 cell set, a critical-path timing pass, core area and power budget, an I/O and power-ring floorplan with an IR-drop figure, a package view and a GDSII artifact.',
    method:
      'Technology mapping onto library cell descriptors using their real pin names, wide gates decomposed into trees of native cells so every emitted instance is a library cell, an STA pass over the mapped graph, and a binary GDS writer for the SkyWater 130 nm layer set (PRBoundary, NWell, Diff, Poly, Li1, M1-M5).',
    notCovered: [
      'The GDSII is a flow artifact for inspection and education. It is not DRC or LVS-clean foundry tapeout.',
      'No analog, custom or transistor-level layout editor.',
      'Power is labelled estimated dynamic power at 100 MHz, and the floorplan IR drop is an empirical current estimate from cell area at typical activity — there is no grid IR solver behind it.',
    ],
    validatedBy: [
      'src/lib/ic/logicSynthesis.test.ts',
      'src/lib/ic/standardCellLibrary.test.ts',
      'src/lib/ic/icFlowAdapter.test.ts',
      'src/lib/ic/siliconFloorplan.test.ts',
      'src/lib/ic/gdsExport.test.ts',
      'src/lib/ic/chipPackaging.test.ts',
    ],
  },
  {
    id: 'logic-fpga',
    family: 'logic',
    title: 'FPGA resource estimation',
    modes: ['fpga'],
    computes: 'Gate and flip-flop counts, a one-LUT-per-gate estimate and a design manifest for the selected device family.',
    method: 'Structural elaboration of the parsed netlist counted against the declared device family.',
    notCovered: [
      'No place-and-route, vendor mapping or timing analysis, so the flow never invents an Fmax, a worst-negative-slack, BRAM or DSP inference, a vendor bitstream or a successful device programming event. Those need Vivado, Quartus, Diamond or Gowin plus a connected programmer, and the panel says so.',
      'One LUT per gate is a counting estimate, not a mapping: a real tool packs logic into look-up tables differently, so a design inside the declared cell count can still fail to fit the device through congestion or routing.',
    ],
    validatedBy: [
      'src/lib/fpga/fpgaDesignFlow.test.ts',
      'src/__tests__/demoScenarioPanels.test.tsx',
    ],
  },
  {
    id: 'logic-devices',
    family: 'logic',
    title: 'Device Lab behaviour models',
    modes: ['components', 'simulation'],
    computes: 'Datasheet-level shift registers, decoders, FRAM, EEPROM and NOR flash behaviour: page and erase rules, address legality and the time each operation would take.',
    method:
      'Behavioural models over the declared part, with every operation validating its address and byte range and reporting the datasheet timing constant, so a simulation cannot claim an out-of-range store or an instantaneous EEPROM write.',
    notCovered: [
      'Not full SPI or I2C bus timing and not analog electrical models.',
      'Pinouts, capacities and interface timing are asserted as data; a part table edit that contradicts the datasheet fails a test.',
    ],
    validatedBy: [
      'src/lib/electronics/logicMemory.test.ts',
      'src/lib/electronics/memoryBehavior.test.ts',
      'src/lib/electronics/standardIcs.test.ts',
    ],
  },
  // ── control ────────────────────────────────────────────────────────────────
  {
    id: 'control-lti',
    family: 'control',
    title: 'LTI analysis',
    modes: ['control'],
    computes: 'Poles and zeros, Bode and Nyquist data, gain and phase margins, stability, and step and impulse response metrics of the declared loop.',
    method:
      'SISO transfer-function algebra with Durand-Kerner root finding on a scaled variable (Horner on raw monic coefficients overflows long before the roots do), state-space simulation by RK4, and margins read from the frequency data.',
    notCovered: [
      'Time delays of the form exp(-sT), sampled-data or discrete design, MIMO systems and pole placement are not modelled.',
      'Bode margins are meaningful for open-loop stable, minimum-phase plants; the reported closed-loop stability flag always comes from the actual closed-loop poles, never from the margins.',
      'Root finding is quadratic for distinct roots but only linear for repeated ones: a degree-50 polynomial with one root repeated 50 times is accurate to roughly the square or cube root of machine epsilon, about 1e-4 relative.',
      'Margins describe the declared model, not a plant identification of real hardware.',
    ],
    validatedBy: [
      'src/lib/control/transferFunction.test.ts',
      'src/lib/control/pid.test.ts',
      'src/__tests__/controlSystemsPanel.test.tsx',
    ],
  },
  {
    id: 'control-pid',
    family: 'control',
    title: 'PID control law',
    modes: ['control'],
    computes: 'The continuous controller transfer function and closed loop, and a sampled controller step that advances one control cycle at a time.',
    method:
      'Continuous form as a proper rational TF; the sampled path filters the derivative term and applies conditional-integration anti-windup, and is driven through a simulated plant and actuator for the relay, search and surrogate routes.',
    notCovered: [
      'The derivative is filtered deliberately: an ideal differentiator has unbounded high-frequency gain and cannot be simulated honestly.',
      'Anti-windup and saturation are nonlinear, which is why the sampled loop, not the continuous margins, is what proves them.',
    ],
    validatedBy: ['src/lib/control/pid.test.ts', 'src/lib/control/autoTune.test.ts'],
  },
  {
    id: 'control-autotune',
    family: 'control',
    title: 'PID auto-tuning, four routes',
    modes: ['control'],
    computes: 'Proportional, integral and derivative gains from four independent design routes, each reporting its cost breakdown, resulting margins, termination reason and the evaluations it consumed.',
    method:
      'Rules of thumb on a first-order-plus-dead-time model (Ziegler-Nichols open loop, SIMC lambda tuning) fed by the identifier; relay auto-tuning that closes the loop with a hysteretic relay, measures the real limit cycle and converts it to ultimate gain and period; bounded search over the actual closed-loop simulation with differential evolution, Nelder-Mead or simulated annealing; and surrogate-assisted search that trains a Gaussian process on measured costs and spends simulations only on the candidates its lower-confidence-bound acquisition picks.',
    notCovered: [
      'The linear routes judge the continuous-time loop. Actuator saturation and anti-windup are nonlinear and are checked separately with the sampled loop.',
      'Ziegler-Nichols is documented to give roughly 40-60 percent overshoot and to be aggressive on delay-dominant plants; that behaviour is reported, not hidden.',
      'Search finds the best point inside the bounds you gave it under the budget you allowed. A termination of budget means the cap ran out, not that the optimum was found.',
      'The surrogate only knows the sampled points, so an initial design that misses a narrow basin will never find it; the process is trained on costs in raw units, so a cost span of 1e12 makes the kernel length scale meaningless.',
      'This is the design half of the toolbox, not the agent layer: a tuner is a deterministic numerical routine the engineer starts, bounds and audits.',
    ],
    validatedBy: [
      'src/lib/control/autoTune.test.ts',
      'src/lib/control/pid.test.ts',
      'src/lib/ml/ml-toolbox.test.ts',
      'src/components/control/ControllerToolbox.test.tsx',
    ],
  },
  {
    id: 'control-ml',
    family: 'control',
    title: 'ML and heuristic toolbox',
    modes: ['control', 'dashboard', 'mechanical'],
    computes: 'Regression, classification, clustering, PCA, a small MLP, system identification, Gaussian-process surrogates and the bounded optimisers used for sweeps and sizing.',
    method:
      'Deterministic seeded implementations throughout: Cholesky solves on dense normal equations, exact GP regression with an RBF kernel, observation noise on the diagonal and a marginal-likelihood grid for hyper-parameters rather than guessed lengths; k-means with k-means++ seeding; PCA by Jacobi symmetric eigendecomposition with eigenvector signs normalised to a stated convention; Adam-trained MLPs with hand-written backprop.',
    notCovered: [
      'No run claims to have found the optimum. Every optimiser is bounded by an explicit evaluation budget, reproducible from a seed, and reports why it stopped; k-means converges to a local minimum and reports its restarts, inertia and stopping reason.',
      'Accuracy is a held-out k-fold cross-validation number or the fit residual, never an in-sample R-squared presented as a prediction claim, and a neural net train loss is not offered as quality.',
      'System identification reports one-step and free-running simulation error separately, because a good fit with a bad simulation is the common failure mode and showing only the first hides it.',
      'Scope is dense linear algebra that fits in memory: regression, GP and PCA problems, not large-scale learning.',
      'This toolbox is distinct from the agent layer — nothing here starts a design loop by itself.',
    ],
    validatedBy: [
      'src/lib/ml/ml-toolbox.test.ts',
      'src/lib/optimization/designSearch.test.ts',
      'src/lib/optimization/evolutionaryOptimization.test.ts',
    ],
  },
  // ── machine ────────────────────────────────────────────────────────────────
  {
    id: 'machine-models',
    family: 'machine',
    title: 'Electric machines',
    modes: ['machines'],
    computes: 'Speed, torque, current and back-EMF traces plus steady operating point for brushed DC motor and generator, BLDC/PMSM and stepper configurations, against datasheet envelopes.',
    method:
      'Lumped-parameter ODEs integrated by the same RK4 solver the robotics domain uses: a two-state brushed DC model, a surface-magnet dq PMSM model, and a stepper with first-order L/R phase lag. The UI picks a 1 ms step.',
    notCovered: [
      'No magnetic saturation, cogging or detent harmonics, eddy and hysteresis loss, mid-band resonance, thermal derating or finite-element field solution.',
      'Brushed DC does not model brush drop, armature reaction or thermal drift.',
      'The PMSM assumes Ld = Lq and an ideal continuous voltage-source inverter with no switching ripple; it is not a drive-signal-level model.',
      'Stepper damping is one lumped coefficient standing in for bearing friction and back-EMF/eddy effects.',
      'A non-physical model throws instead of returning a stable-looking trace.',
    ],
    validatedBy: [
      'src/lib/electronics/machineDynamics.test.ts',
      'src/lib/electronics/machines.test.ts',
      'src/__tests__/machineSimulatorPanel.test.tsx',
    ],
  },
  {
    id: 'machine-margins',
    family: 'machine',
    title: 'Ratings, margins and thermal headroom',
    modes: ['schematic', 'simulation', 'bom'],
    computes: 'Per-part voltage, current, power and junction-temperature margins against the solved operating point, with the limiting quantity named.',
    method:
      'Every number comes from a solved circuit and a rating declared somewhere real — a component property, a package table or the vendor model catalogue. Junction temperature is a first-order ambient plus P times thetaJA estimate.',
    notCovered: [
      'An undeclared rating produces an explicit not-rated entry instead of a comfortable pass.',
      'thetaJA from the typical package table is flagged as estimated; it is not a board-level thermal solve.',
      'The agent-facing assessment refuses to report utilisation before a simulation exists: margins are measured, never guessed.',
      'No derating-standard conformance, qualification or life prediction is claimed.',
    ],
    validatedBy: [
      'src/lib/electronics/designMargins.test.ts',
      'src/lib/electronics/passives.test.ts',
      'src/lib/agents/cadTools.test.ts',
    ],
  },
  {
    id: 'machine-parts',
    family: 'machine',
    title: 'Part catalogues, power and harness calculators',
    modes: ['components', 'bom', 'schematic'],
    computes: 'E12/E24 series values, package power ratings, dielectric tolerance and voltage, connector and BGA ball maps, battery chemistries with discharge curves and ESR, buck and LDO sizing, AWG conductor resistance over temperature, bundle derating and minimum gauge for an allowed loop drop, plus ADC/DAC LSB maths, baud error, I2C pull-up bounds, CAN bit timing, USB power rules, reflow and crimp profiles.',
    method:
      'Published standard tables (IEC series, SAE AS50881 / IPC-2152 ampacity, J-STD-020, IPC/WHMA-A-620, IPC-CC-830) with the constants kept in SI and separated from the formulas, applied by pure functions over the declared part.',
    notCovered: [
      'There is no live distributor price, stock or lifecycle fetch; the catalogue is what is recorded locally.',
      'A datasheet import is a proposal the engineer confirms and unparsed parameters stay unparsed; a part with 48 datasheet pins becomes a 48-pin symbol — the importer never invents a pin.',
      'Where a property is process-dependent, such as FR4 permittivity or solder alloy, the nominal value carries its typical spread.',
      'A duplicate ball, missing power or unmapped package pin fails loudly.',
    ],
    validatedBy: [
      'src/lib/electronics/componentCatalog.test.ts',
      'src/lib/electronics/passives.test.ts',
      'src/lib/electronics/connectors.test.ts',
      'src/lib/electronics/wireHarness.test.ts',
      'src/lib/electronics/powerSources.test.ts',
      'src/lib/electronics/socPackages.test.ts',
      'src/lib/ai/datasheetParser.test.ts',
      'src/__tests__/datasheetImporter.test.tsx',
    ],
  },
  // ── firmware ───────────────────────────────────────────────────────────────
  {
    id: 'firmware-build',
    family: 'firmware',
    title: 'Firmware and block-program build',
    modes: ['embedded', 'visual'],
    computes: 'Board-targeted sketch generation from the wiring or a block graph, static analysis with line and column diagnostics, an Intel HEX round-trip, and a compiled block program.',
    method:
      'Template-driven generation for the declared board profile with sanitised identifiers, an analysis pass over the generated sketch that always computes diagnostics and reports flash and RAM figures, and a HEX writer that is re-parsed as the round-trip check. Blocks lower to real function bodies, with entry blocks marked as entry points rather than statements.',
    notCovered: [
      'Flash and RAM sizes are analysis estimates, not linker output. No vendor optimiser or code generator runs in the browser, so the optimisation level, debug flag and warning option are recorded in the generated header rather than applied.',
      'Generated code is not a hardware-in-the-loop proof of timing or interrupt latency.',
      'A generator that throws produces an empty code field and an error, never a half-written sketch presented as success.',
      'Importing a block file validates every node and edge: a non-JSON or non-program file replaces nothing and says so, and entries the validator rejects are counted in the message rather than dropped silently.',
    ],
    validatedBy: [
      'src/lib/compilation/compiler.test.ts',
      'src/lib/compilation/intelHex.test.ts',
      'src/lib/programming/visualProgram.test.ts',
      'src/__tests__/boardProgrammingPanel.test.tsx',
      'src/__tests__/visualProgrammingDemo.test.tsx',
      'src/__tests__/visualProgrammingImport.test.tsx',
    ],
  },
  {
    id: 'firmware-flash',
    family: 'firmware',
    title: 'Flashing, imaging and hardware bridges',
    modes: ['embedded', 'imaging', 'hil'],
    computes: 'WebSerial Arduino STK500v1 uploads with page read-back verification, OS-image chunk plans with per-chunk SHA-256 and verify-against-source, boot-contract checks, HIL suites and I2C/SPI/UART/CAN interface sessions.',
    method:
      'The browser half builds and verifies work; a Node-only sidecar executes it. Flash frames are newline-delimited JSON with request ids and per-request timeouts, every write is hash-checked before success is reported, and writes past the device size are refused rather than clipped. Where permissions allow, WebSerial and WebUSB are used directly; otherwise a localhost WebSocket companion bridge carries raw block SD/eMMC writes and OpenOCD JTAG/SWD.',
    notCovered: [
      'A browser cannot touch block devices. Without a granted port, uploadSketch returns an explicit no-transport refusal — an honest dead end, never a fake upload; the absence of WebSerial is a typed refusal.',
      'The sidecar runs against a file-backed device in tests and development; a real deployment opens the SD device node.',
      'Simulated I2C and SPI buses answer by a declared convention (devices at even addresses 0x10 to 0x50, deterministic bytes from address and register) — that is a stand-in for a bridge, not hardware. Real traffic needs a connected native USB bridge; CAN is simulated or SLCAN over an attached UART.',
      'Malformed, wrong-length or non-byte replies are rejected, never zero-filled.',
      'A HIL pass proves the contract against the modelled board, not the behaviour of physical hardware.',
      'A flashed image is checked against its boot contract (config, cmdline, kernel, DTB, first-boot handshake, serial console) before power-on; a missing kernel or silent console is a named refusal.',
    ],
    validatedBy: [
      'src/lib/programming/uploadSession.test.ts',
      'src/lib/programming/boardProgrammer.test.ts',
      'src/lib/programming/imageFlasher.test.ts',
      'src/lib/programming/flashDaemon.test.ts',
      'src/lib/programming/companionBridge.test.ts',
      'src/lib/programming/linuxBringUp.test.ts',
      'src/lib/hardware/hardwareInterfaces.test.ts',
      'src/__tests__/piImagingPanel.test.tsx',
    ],
  },
  // ── agents ─────────────────────────────────────────────────────────────────
  {
    id: 'agents-surface',
    family: 'agents',
    title: 'Agent tool surface',
    modes: ['agents'],
    computes: 'The exact set of CAD calls an agent may make — 15 sheet tools, 8 board tools, 8 mechanical tools — each returning a fresh canonical observation plus an SVG, and a bounded autopilot that scores every iteration and restores the best design.',
    method:
      'Registered tools over the live store (cad.observe, listLibrary, addPart, removePart, movePart, setProperty, connect, disconnect, nameNet, simulate, assess, erc, exportNetlist, setFirmware, undo; eda.simulate, observe, route, movePart, addTrace, addVia, drc, exportFab; mech.observe, addPart, movePart, resizePart, setSupport, setLoad, analyze, autopilot), run through a harness that enforces a call and wall-time budget, approval gates and an audit trail, with a symbolic verifier for ground-truth connection, power-rail, bus-contention and Boolean claims.',
    notCovered: [
      'Electrical, board and mechanical sheets only: robotics, RF, HDL/IC, digital-twin and plugin authoring are not agent-driven yet.',
      'Agents act through declared tools, never raw code, and a denial is recorded as denied by approval gate.',
      'No tool drives hardware: cad.setFirmware only stores source text, and flashing lives outside the registered surface.',
      'Deletion of a mechanical part is deliberately not exposed — trimming an assembly is a human decision, while adding and reshaping is the loop.',
      'A change is only claimed when the next observation shows it, and a simulation result is tied to the design fingerprint it was solved on.',
      'Rail shorts are refused: connecting a net to 0 V or shorting two named rails returns a rename instruction, and eda.movePart needs the live schematic because payload-only boards are read-only.',
      'The autopilot is a bounded search and reports that a bounded search is not a global optimum; budget exhaustion is emitted as a budget outcome.',
    ],
    validatedBy: [
      'src/lib/agents/cadTools.test.ts',
      'src/lib/agents/edaTools.test.ts',
      'src/lib/agents/mechanicalTools.test.ts',
      'src/lib/agents/agentHarness.test.ts',
      'src/lib/agents/autopilot.test.ts',
      'src/lib/agents/mechanicalAutopilot.test.ts',
      'src/lib/agents/symbolicVerifier.test.ts',
      'src/lib/agents/designSnapshot.test.ts',
      'src/__tests__/agentPanel.test.tsx',
    ],
  },
  {
    id: 'agents-assistant',
    family: 'agents',
    title: 'Assistant, natural language and cloud runners',
    modes: ['agents', 'dashboard'],
    computes: 'Chat answers over the design context, natural-language command routing, datasheet question extraction, a durable local agent session and a cloud runner transport contract.',
    method:
      'Provider calls behind the configured adapter; intents map to store actions that report executed or rejected; session records persist in local storage without their SVG payloads, which are regenerated from the design on demand.',
    notCovered: [
      'Without an AI provider credential there are no live answers: the panel reports the provider as unavailable instead of inventing one.',
      'Local autopilot needs no server. Always-on or scheduled agents need a server-side runner with a job queue, a sandboxed worker, durable design storage and an authenticated token exchange; until that exists, a missing configuration is reported honestly rather than pretended.',
      'Assistant prose is not a substitute for the computed result shown next to it.',
    ],
    validatedBy: [
      'src/lib/ai/aiService.test.ts',
      'src/lib/ai/datasheetParser.test.ts',
      'src/lib/nlp/nlpService.test.ts',
      'src/lib/agents/cloudAgentTransport.test.ts',
      'src/lib/agents/agentSession.test.ts',
      'src/__tests__/aiChatPanel.test.tsx',
    ],
    cloudOnly: true,
  },
  // ── platform ───────────────────────────────────────────────────────────────
  {
    id: 'platform-vcs',
    family: 'platform',
    title: 'Version control, projects and undo',
    modes: ['schematic', 'dashboard'],
    computes: 'Content-addressed commits, restore and log per project across domains (schematic, firmware, board, mechanical), the offline project store, backup export and per-keystroke undo.',
    method:
      'Git-like and local-first: one repo per project id in browser storage, a commit id being a SHA-256 over its tree with parents and a tree hash. The first commit of a chain is stored whole and later commits as a JSON patch against that parent, falling back to a full copy when the patch is not smaller; every snapshot is reconstructed and hash-checked on load.',
    notCovered: [
      'A corrupted or hash-mismatched record is reported, never served silently as history.',
      'Local-first: no remote repository, no push or pull, no merge engine or branch federation.',
      'Persistence is browser storage: a cleared origin clears the history, which is why backup export exists.',
      'The launcher states the revision count stored in this browser, never a cloud-side history, and a project read that failed is named as a failure with a retry instead of being dressed up as "no projects yet".',
    ],
    validatedBy: [
      'src/lib/vcs/vcsService.test.ts',
      'src/lib/offlineProjectStore.test.ts',
      'src/lib/backup/backupService.test.ts',
      'src/__tests__/domainDesignPersistence.test.tsx',
      'src/stores/undo.test.ts',
      'src/__tests__/projectManager.test.tsx',
    ],
  },
  {
    id: 'platform-collab',
    family: 'platform',
    title: 'Collaboration and presence',
    modes: ['schematic', 'plugins'],
    computes: 'Shared sessions with remote cursors and selections, role and invite management, and presence rosters.',
    method:
      'Supabase Realtime broadcast channels as the transport, over an Operational-Transformation-style operation queue ordered by Lamport timestamp and user id; share and invite metadata persists locally with the in-memory map as a cache.',
    notCovered: [
      'Falls back to an in-memory local session when Supabase is unavailable, and a channel subscribe that does not settle in 8 s is reported as a timeout.',
      'Ordering is OT-lite for co-editing presence, not a merge engine that reconciles conflicting netlist edits.',
      'Without credentials, cloud sync and invitations are unavailable by design; the role and share UI still works locally.',
      'Presence and broadcast are separate channel calls, so a session can deliver operations while peers no longer list you; the panel names that half-failure instead of reporting a healthy realtime session.',
    ],
    validatedBy: [
      'src/lib/collaboration/collaborationService.test.ts',
      'src/lib/collaboration/collaborativeEditor.test.ts',
      'src/lib/collaboration/collaborativeEditorPresence.test.ts',
      'src/lib/collaboration/useCollaborationPresence.test.ts',
      'src/__tests__/collaborativePanelStatus.test.tsx',
    ],
    cloudOnly: true,
  },
  {
    id: 'platform-security',
    family: 'platform',
    title: 'Security telemetry and asset protection',
    modes: ['siem'],
    computes: 'An event log with alert lifecycle and audit trail, heuristic threat detection (port scan, exfiltration, privilege escalation, brute force), control checklist status, and encrypted, tamper-evident asset storage with role-based access.',
    method:
      'In-memory event log capped at 10 000 events and an audit trail capped at 50 000 entries, swept on an interval from real recorded state; asset protection uses AES-GCM 256 with PBKDF2 at 100 000 SHA-256 iterations over five roles and a hash-chained audit log.',
    notCovered: [
      'The ISO 27001, IEC 62443, NIST CSF, GDPR and HIPAA entries are heuristic checklist evidence computed from local state, not an audited certification. No GDPR, ISO 27001 or IEC 62443 certification is claimed anywhere in this product.',
      'TLS evidence is derived from whether the page is served over HTTPS; network segmentation is inferred from declared zones. There is no packet capture and no external collector — the traffic arrays are passed in by callers.',
      'Crypto is browser Web Crypto on this device. There is no key management service, HSM or recovery path.',
      'The SIEM surface is design-time audit visibility, not a monitored production SOC with guaranteed delivery.',
    ],
    validatedBy: [
      'src/lib/siem/siemService.test.ts',
      'src/lib/security/assetSecurity.test.ts',
      'src/__tests__/adminConsole.test.tsx',
    ],
  },
  {
    id: 'platform-plugins',
    family: 'platform',
    title: 'Plugins and marketplace',
    modes: ['plugins', 'marketplace'],
    computes: 'Permission-gated plugin registration for tools, components, simulators and exporters with lifecycle, and versioned design bundles that can be browsed, installed, rated and published.',
    method:
      'Every registration path takes the manifest declared permissions and the action required, and throws with the plugin id, the action and the missing permission; manifests are validated for id format, semver and API version so a malformed entry fails at install, not at runtime. Network actions map to explicit network:fetch and network:websocket permissions.',
    notCovered: [
      'Permission-gated but not sandboxed: an installed plugin runs in the extension host with whatever permissions it declared.',
      'Plugin packages declare tool bodies; the harness executes the built-in tools, and a plugin-declared tool has no separate runtime today.',
      'The design-bundle and plugin-package registries are intentionally separate, and the marketplace panel drives design bundles. Listings are local records, not a hosted store or a signed supply chain.',
      'Built-in packages are registered once at module load, before any component exists; a package the registry refuses is named by the panel and its Install button fails, because no re-seed is attempted.',
    ],
    validatedBy: [
      'src/lib/plugins/pluginPermissions.test.ts',
      'src/lib/plugins/pluginSystem.test.ts',
      'src/lib/marketplace/marketplaceService.test.ts',
      'src/lib/marketplace/designMarketplace.test.ts',
      'src/__tests__/pluginMarketplaceSeed.test.tsx',
    ],
  },
  {
    id: 'platform-twin',
    family: 'platform',
    title: 'Digital twins and fleet monitoring',
    modes: ['twin'],
    computes: 'Twin registry with status and health scoring, telemetry ingestion, a fleet view of robots, PLCs, gateways, sensor hubs and vehicles with aggregated telemetry and a command queue, and a twin that solves its mirrored circuit.',
    method:
      'A deterministic in-memory model with no background timers: the twin drives the same DC operating-point solver the simulation panel uses, so a step shown on the twin is the same solve. Fleet commands are queued, acknowledged or failed by the caller-supplied transport.',
    notCovered: [
      'No transport is bundled. Connecting requires a configured MQTT, CoAP or WebSocket endpoint and the entry points throw when it is missing, rather than pretending a link exists.',
      'Nothing is contacted over the network by the fleet manager: device state and telemetry are supplied by callers.',
      'No model is fitted and no value is invented when a reading is absent.',
      'Health scores describe the modelled asset, not a measured machine.',
    ],
    validatedBy: [
      'src/lib/digitalTwin/digitalTwinService.test.ts',
      'src/lib/iiot/fleetManager.test.ts',
      'src/__tests__/digitalTwinFleetPanel.test.tsx',
    ],
  },
  {
    id: 'platform-compute',
    family: 'platform',
    title: 'Compute capability reporting',
    modes: ['dashboard'],
    computes: 'Device capability and acceleration-path reporting, and the dispatch that chooses CPU, Worker or WebGPU for a thermal grid.',
    method: 'Adapter probing that resolves every failure mode — no navigator.gpu, no adapter, a denied request, a lost device — to null, after which the caller falls back to the Worker or main-thread path with the same physics.',
    notCovered: [
      'It never advertises an acceleration path that the dispatch code cannot execute.',
      'The e-CAD analyses are CPU-first by design; only large thermal grids take the GPU or Worker route.',
      'A panel that reports a speed-up without measuring one would be a claim, so the panel reports the device state instead.',
    ],
    validatedBy: [
      'src/lib/acceleration/webgpuDevice.test.ts',
      'src/lib/acceleration/acceleratedSimulation.test.ts',
    ],
  },
  {
    id: 'platform-admin',
    family: 'platform',
    title: 'Administration, quotas and usage',
    modes: ['dashboard', 'siem'],
    computes: 'The administration console view of users, roles, quotas and usage, with a device-local append-only usage ledger.',
    method:
      'Cloud mode reads the profiles table from the admin migration; offline mode has exactly one principal, the device owner. Quotas are evaluated as policy from the role table, and the local ledger aggregates deterministically.',
    notCovered: [
      'A limit of null means unlimited and the owner is always unlimited, so a workspace can never lock itself out of administration.',
      'When the cloud schema is absent or unreachable the console says so instead of rendering a made-up user list, and it labels cloud-only capabilities without faking invitations.',
      'The ledger never leaves the browser and is not an analytics pipeline; mirroring to the cloud table is best-effort and only in a configured deployment, and a failed mirror never breaks the design action it was recording.',
      'The guided tour counts itself honestly: a card closed before the last step is recorded as an exit carrying the number of steps actually opened, and only reaching the end — or taking the register hand-off there — is recorded as a finished tour.',
      'Console numbers are this client ledger, not a billing system.',
    ],
    validatedBy: [
      'src/lib/admin/adminService.test.ts',
      'src/lib/admin/quotaPolicy.test.ts',
      'src/lib/admin/usageLedger.test.ts',
      'src/__tests__/adminConsole.test.tsx',
      'src/__tests__/appShell.test.tsx',
    ],
  },
  {
    id: 'platform-i18n',
    family: 'platform',
    title: 'Themes, motion and language',
    modes: ['schematic'],
    computes: 'Theme preference, generated token sets, reduced-motion behaviour and the stored language choice.',
    method:
      'Raw HSL token triplets applied through CSS custom properties, with a class on the root element that collapses animation and transition durations when the animation setting is off or the system prefers reduced motion.',
    notCovered: [
      'The language selector stores a preference; only English strings ship.',
      'The tour spotlight tracks the element its marker query really matched, re-attaching the layout observer when a lazy workspace mounts or a viewport crossing swaps a control for its duplicate; a target that has left the viewport entirely falls back to a plain centred card instead of a spotlight around nothing.',
      'When a coach mark has nowhere beside the target to sit, it picks the dock corner that leaves the target visible and, if the card would bury it anyway, drops the spotlight instead of drawing brackets the engineer cannot see; below 620 px of viewport height the stage checklist folds away to buy that room, and a window shorter than the card still gets a teaching card rather than a false spotlight.',
      'Theme tokens live in code, not in the stylesheet, so a theme change cannot desync from the canvas colours.',
    ],
    validatedBy: ['src/lib/theme/theme.test.ts', 'src/__tests__/onboardingTour.test.tsx'],
  },
  {
    id: 'platform-help',
    family: 'platform',
    title: 'Hover help, guides and tutorials',
    modes: [
      'schematic', 'simulation', 'convert', 'pcb', 'preview3d', 'bom',
      'control', 'machines', 'rf', 'hdl', 'icdesign', 'fpga',
      'mechanical', 'robotics', 'embedded', 'imaging', 'visual', 'hil',
      'twin', 'agents', 'components', 'plugins', 'dashboard', 'siem', 'marketplace',
    ],
    computes:
      'One description registry shared by the delayed hover tooltips and the help centre, plus workspace guides, a control reference, the shortcut list and tutorials that load a named demo.',
    method:
      'A data registry keyed by control, rendered by a portal tooltip whose placement is computed against the trigger and viewport and flipped when it does not fit. The help centre reads the same registry, the live workspace metadata, the capability records and the demo catalogue; tutorials are validated against those demo ids and workspace modes by test.',
    notCovered: [
      'Tutorial steps are self-checked. The workbench does not watch the screen, inspect the design or grade the result; copying a step does not prove a circuit is correct.',
      'Hover copy describes what a control does on screen. It is not a validity statement about any result the control produces.',
      'Tutorial progress is stored in this browser only, and a cleared or blocked storage loses it rather than syncing it.',
      'The shortcut list names only shortcuts that are implemented; a command without a key is described without one.',
    ],
    validatedBy: [
      'src/__tests__/hoverHelp.test.tsx',
      'src/__tests__/helpCenter.test.tsx',
      'src/__tests__/tutorials.test.ts',
      'src/__tests__/tutorialRunner.test.tsx',
    ],
  },
]

/** Every mode the registry speaks for, derived so it cannot drift from the data. */
export const CAPABILITY_MODES: readonly WorkspaceMode[] = Array.from(
  new Set(CAPABILITY_RECORDS.flatMap((record) => record.modes)),
).sort()

export type CapabilityFilter = 'all' | CapabilityFamilyId

export const CAPABILITY_FILTERS: readonly CapabilityFilter[] = [
  'all',
  ...CAPABILITY_FAMILIES.map((family) => family.id),
]

export const CLOUD_ONLY_CAPABILITY_COUNT = CAPABILITY_RECORDS.filter((record) => record.cloudOnly).length

export function familyLabel(id: CapabilityFamilyId): string {
  return CAPABILITY_FAMILIES.find((family) => family.id === id)?.label ?? id
}

export function matchesQuery(record: CapabilityRecord, query: string): boolean {
  if (!query.trim()) return true
  const haystack = [
    record.title,
    record.computes,
    record.method,
    ...record.notCovered,
    familyLabel(record.family),
    ...record.validatedBy,
  ]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

export function filterCapabilities(
  family: CapabilityFilter,
  query: string,
  mode: WorkspaceMode | null = null,
): CapabilityRecord[] {
  return CAPABILITY_RECORDS.filter(
    (record) =>
      (family === 'all' || record.family === family) &&
      (!mode || record.modes.includes(mode)) &&
      matchesQuery(record, query),
  )
}
