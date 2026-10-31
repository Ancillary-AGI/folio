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
  { id: 'wave', label: 'RF, photonics & quantum', description: 'Antenna and transmission-line synthesis, radio and fibre link budgets, and statevector quantum circuits.' },
  { id: 'logic', label: 'HDL, FPGA & silicon', description: 'RTL subset elaboration, simulation, resource estimation and the SKY130 flow.' },
  { id: 'control', label: 'Control & ML toolbox', description: 'LTI analysis, PID design and tuning routes, and the heuristics the designer drives.' },
  { id: 'machine', label: 'Machines & parts', description: 'Electric-machine operating points plus part ratings, margins, catalogues and power sources.' },
  { id: 'firmware', label: 'Firmware, embedded & HIL', description: 'Code generation, static analysis, flashing, imaging and hardware interface simulation.' },
  { id: 'agents', label: 'Agents & assistant', description: 'The tool surface an agent may call, the symbolic verifier and the assistant integrations.' },
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
    id: 'circuit-deck-import',
    family: 'circuit',
    title: 'SPICE deck import',
    modes: ['simulation'],
    computes:
      'A circuit netlist and analysis plan read from a SPICE deck (.cir/.sp/.ckt), previewed with its title, device count and analysis card, then solved by the same engine as the drawn sheet.',
    method:
      'A fail-loud line parser: the first line is the title; `*` comments and `;`/`$` inline comments are stripped; `+` continuations are joined; element cards are classified by designator (R/C/L/V/I/D/Q/M/J/E/G/B/S/W/T/K). Source waveforms come from PULSE/SIN/EXP/SFFM/PWL syntax, .model cards are resolved by name regardless of card order, and .op/.dc/.tran/.ac/.noise/.options/.temp cards map onto the engine\'s analysis parameters. A construct the engine cannot represent is an import error naming its line, never a dropped card.',
    notCovered: [
      'Subcircuits (X), .include/.lib files, .param/.func expressions, .step, and F/H (CCCS/CCVS) sources are refused by name: there is no hierarchy, file resolution or expression evaluator, and none is approximated by a fixed value.',
      'Deck AC import accepts a decade sweep only; a LIN or OCT sweep is refused rather than converted.',
      '.model cards are limited to the parameters the model library defines; unknown parameters are reported, not silently ignored.',
      'One analysis runs per deck. When a deck carries several analysis cards, the first is solved and the import warning names the cards that are not run.',
      'An imported deck is solved, not certified: convergence and a plausible operating point do not prove the physical build.',
    ],
    validatedBy: [
      'src/lib/simulation/spiceImport.test.ts',
      'src/lib/simulation/modelLibrary.test.ts',
    ],
  },
  {
    id: 'circuit-sketch',
    family: 'circuit',
    title: 'Freehand sketch and image-to-schematic',
    modes: ['schematic'],
    computes:
      'Parts, wires and junctions read from pen, finger or mouse strokes — or from a raster drawing — previewed in place and committed as ordinary schematic objects that ERC, netlists, simulation and PCB conversion already understand.',
    method:
      'Strokes are resampled by arc length, simplified with Ramer–Douglas–Peucker, clustered by stroke distance and merged across small gaps, then scored by dilated intersection-over-union against procedural templates generated from the shipped library symbol geometry at 0/90/180/270°. Leftover ink is chained into wires and small dense ink into junction dots. Images run through an Otsu luminance cut, Zhang–Suen thinning and a skeleton graph walk before the same recogniser. Placement never rescales: parts land at library size, ink sets position and rotation, and wire ends snap to real pins within a radius derived from library size.',
    notCovered: [
      'Templates exist for resistor, capacitor, inductor, diode, ground, source and junction only. Any other part is reported as rejected ink, never guessed — a weak template match is not a placed component.',
      'Rotation support is the four quarter turns; a symbol drawn at an arbitrary angle is read as the nearest one.',
      'Image trace assumes dark line art on a light page. Perspective, shading, pencil texture and overlapping annotation are not corrected, and a photograph may trace poorly or not at all.',
      'Recognised connectivity is geometric — snapped endpoints, inserted junctions, shared pins — and is not an electrical proof. ERC and simulation still decide whether the circuit works.',
      'Sketch ink is transient: it is not part of the design snapshot, undo stack or save until it is placed. The stylus pressure only varies ink width on screen; it does not change recognition.',
    ],
    validatedBy: [
      'src/lib/sketch/sketch.test.ts',
      'src/lib/sketch/commit.test.ts',
      'src/__tests__/sketchLayer.test.tsx',
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
    computes: 'Steady heat-conduction fields, 1-D axial bar and 2-D pin-jointed truss displacements and reactions, 2-D electrostatic potential fields with a reported residual, air-standard and Rankine gas cycles, Darcy–Weisbach pipe flow and tree pipe networks, and Sabine/Eyring room acoustics with partition transmission loss.',
    method:
      'Finite differences for the thermal and potential fields, direct stiffness for the bar and truss, all reusing the same dense LU solver as the circuit analyser and reporting the genuine linear residual. Cycles use constant-specific-heat air-standard relations, with an ideal Rankine cycle over a nominal saturated-water table interpolated in ln(p). Pipe friction is 64/Re below 2300 and Swamee–Jain above 4000; networks are validated as a tree and solved by continuity. Room acoustics is Sabine and Eyring over area-weighted absorption; partition TL is the mass law.',
    notCovered: [
      'Verified reduced-order solvers, not a general 3-D FEM suite.',
      'No contact, no plasticity, no frequency response.',
      'Air-standard cycles assume constant specific heats, no pressure loss, no combustion chemistry or dissociation, and no regeneration unless the model states it.',
      'The Rankine cycle uses a nominal saturated-water table at 0.05–100 bar: no superheat, no reheat, no feedwater heating, and an out-of-dome expansion is refused rather than extrapolated.',
      'Pipe flow is single-phase, incompressible and steady. Friction switches discontinuously between the laminar and turbulent correlations across 2300–4000 Re; there is no transitional or compressible model.',
      'Room acoustics assumes a diffuse field: no modal analysis, no diffraction or directivity, and Eyring collapses to zero at unit mean absorption rather than predicting a real room.',
      'Deterministic by construction: an earlier version of this module returned random node voltages, iteration counts and timings. That behaviour is gone and the tests pin it.',
    ],
    validatedBy: [
      'src/lib/simulation/multiphysics.test.ts',
      'src/lib/mechanical/structural.test.ts',
      'src/lib/mechanical/thermofluids.test.ts',
      'src/lib/mechanical/acoustics.test.ts',
      'src/__tests__/mechanicalDesignPanel.test.tsx',
    ],
  },
  {
    id: 'structure-psychrometrics',
    family: 'structure',
    title: 'Psychrometrics and zone cooling loads',
    modes: ['mechanical'],
    computes:
      'Saturation pressure, humidity ratio, enthalpy, specific volume, dew point and wet bulb for moist air, plus a steady design-day sensible/latent zone balance, SHR, supply airflow and one equivalent round duct.',
    method:
      'Buck saturation-pressure correlation with the ASHRAE humidity-ratio, enthalpy and specific-volume relations; dew point and wet bulb solved on the same curve by bisection; ventilation load from dry-air mass flow and enthalpy difference with the sensible split at cp = 1.006 kJ/kg·K; supply air from the sensible load and duct diameter from the velocity–area relation.',
    notCovered: [
      'A steady-state sizing estimate, not a certified Manual J or ASHRAE load calculation.',
      'No thermal mass, solar path or shading, duct gain, fan heat, coil bypass, part-load bins or control schedule.',
      'Psychrometric properties span −20…80 °C over liquid water; ice, supercooled states and altitude-specific psychrometrics are refused outside the correlation.',
      'The duct result is one equivalent round diameter at the target velocity, not a rectangular route or a friction/pressure-loss design.',
      'No coil model: condensation is reported when supply air falls below the room dew point, but coil ADP, bypass factor and condensate rate are not predicted.',
    ],
    validatedBy: [
      'src/lib/mechanical/psychrometrics.test.ts',
      'src/__tests__/mechanicalDesignPanel.test.tsx',
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
      'Footprint patterns are audited as geometry, not as vendor drawings: `footprintLibrary.test.ts` measures every land pair in the library against the shared outline arithmetic and requires every land inside its courtyard, which catches a pitch narrower than its own copper (four packages did when first measured). It does not verify the courtyard against a vendor drawing, and a package whose real body is a different silhouette than declared still passes.',
    ],
    validatedBy: [
      'src/lib/schematicToPcb/schematicToPcbConverter.test.ts',
      'src/lib/manufacturing/kicadNetlist.test.ts',
      'src/lib/manufacturing/eagleSchematic.test.ts',
      'src/lib/simulation/netlistInterchange.test.ts',
      'src/lib/manufacturing/footprintLibrary.test.ts',
      'src/__tests__/schematicToPcbPanel.test.tsx',
    ],
  },
  {
    id: 'board-editor',
    family: 'board',
    title: 'Board layout editing',
    modes: ['pcb', 'convert'],
    computes: 'The board the rest of the app reads — footprint placements, routed traces, vias, keep-out regions and the rectangular outline — with whole-snapshot undo, plus a session-only distance ruler.',
    method:
      'Every pointer gesture is reduced to snapped board millimetres once, so the rubber band, the keep-out rectangle, the outline handle and the measure ruler read the same grid and land snap the copper uses. Placement, routing and keep-out edits share one `useBoardEdits` history of whole-board snapshots; a drag is coalesced by key and sealed on pointer-up, so one drag is one undo step. A drawn keep-out is handed unchanged to both the autorouter, as a reservation it never releases, and the DRC, so the router that avoids a region and the checker that audits it measure the same rectangle. The outline is resized from its right, bottom and corner handles with the origin fixed; the panel turns on the outline rule the checker leaves off by default for callers that carry no outline.',
    notCovered: [
      'The outline is a rectangle only: its right, bottom and corner handles resize it between 10 and 500 mm with the origin pinned, so no non-rectangular cut-out, rounded corner, internal slot or moved origin can be authored here.',
      'Keep-outs are axis-aligned rectangles drawn from two corners, not polygons or arcs. A new one bars every copper layer unless Alt is held, which names the active layer; an inner-layer-only keep-out is enforced by DRC but the autorouter routes only the two outer films and has no inner copper to bar, while a via is barred from any keep-out because its barrel crosses the stack.',
      'The measure tool reports straight-line distance and Δx/Δy between two snapped points only — no routed path length, no impedance-versus-length — and the measurement is session state, not saved with the project.',
      'Moving a part after copper is laid only flags that copper as stale; nothing is ripped up or rerouted until the autorouter or the engineer runs again.',
      'An edit is checked when the checker is run, not continuously during the drag: the panel reports the rules it measured, and a keep-out or outline that a later move invalidates is caught by the next DRC pass.',
    ],
    validatedBy: [
      'src/lib/pcb/boardEdit.test.ts',
      'src/lib/manufacturing/drc.test.ts',
      'src/lib/manufacturing/autorouter.test.ts',
      'src/__tests__/pcbDesignPanel.test.tsx',
    ],
  },
  {
    id: 'schematic-symbols',
    family: 'board',
    title: 'Schematic symbol authoring',
    modes: ['schematic', 'pcb', 'convert'],
    computes: 'A validated symbol body (size plus SVG outline paths) and pin table for a placed part, written to every instance of that library part.',
    method: 'The editor works on a draft of the same width/height/path/pin model the canvas renders by, runs the shared validateSymbol contract on every change, and refuses to apply a draft with faults.',
    notCovered: [
      'The body is authored as SVG path text plus a pin table; there is no graphical pen, arc handle or filled-shape tool.',
      'Circles, rectangles and text already on a library symbol are preserved by an edit but cannot be changed in this editor.',
      'Edits live in the open project: there is no write-back to a shared or vendor library and no symbol version history.',
      'Pin ids are plain text fields; renaming one does not rewrite wires that referenced the old id.',
    ],
    validatedBy: [
      'src/lib/schematic/symbolEditor.test.ts',
      'src/lib/schematic/contextMenu.test.ts',
      'src/__tests__/schematicSymbolEditor.test.tsx',
    ],
  },
  {
    id: 'board-rules',
    family: 'board',
    title: 'ERC and DRC',
    modes: ['schematic', 'pcb', 'convert'],
    computes: 'Electrical rule findings on the net graph and geometry rule findings on the routed board, each naming the offending object.',
    method:
      'ERC classifies unconnected pins by declared pin type (nc pins are skipped) and reports each physical problem exactly once: one violation per multi-driver net, one per power/ground short, and a warning when a net joins input pins only with nothing to drive it. Nets are derived from wires on wire-only sheets. DRC uses exact axis-aligned and circle geometry, oval pads bounded by their box, and treats an empty layer set as all layers. Every outline — a land, a trace, a via annulus — comes from one shared measure in src/lib/geometry/landShape.ts, so the router that reserves clearance, the stitch planner that sizes a ring and the checker that audits the finished board cannot each hold a slightly different idea of the same copper; two edge-aligned rectangles that interpenetrate report 0 rather than their depth, which fails every positive rule identically. A plane board (poured rails, stitched lands) is handed to the same checker through `planeBoardDrc`, at the tightest via rule its own spec declares, so the demo\'s "DRC clean" is a reading taken when the board is built.',
    notCovered: [
      'DRC is a pre-fabrication gate, not a foundry CAM approval, and the fab-profile gate implements one vendor profile only; another fab is refused rather than approximated.',
      'No field solver: silkscreen legibility, etch asymmetry and copper balance are not checked.',
      'The no-driver warning only fires when a net joins input pins and nothing else; an input fed through a passive part is not flagged, because a connector or series resistor is a legitimate entry point from off-sheet.',
      'Schematic cross-sheet imports reject duplicate reference designators, because two R1 would silently merge into one device.',
      'A plane board\'s scene carries no layer span per hole, so its audit cannot tell a blind laser microvia from a through barrel: a 0.1 mm stitch is held to 0.1 mm and passes, while the 16:1 aspect ratio that makes it HDI-only is not a rule in `DRCSettings` at all and the 3-D view draws a full barrel.',
      'Courtyard overlap is not measured on a plane board — those layouts place parts by their land patterns, and the checker\'s courtyard comes from a schematic symbol box. `assertLandsClear` and the footprint pattern audit are what keep land copper apart there, at two tiers: the fab\'s spacing rule inside one package, whose lands are one print, and the placement rule between packages.',
      'Unconnected-net, acute-angle and trace-length rules are off for a plane board: its rails are pours the checker would read as open copper, and the other two are SI questions rather than fab-ability.',
    ],
    validatedBy: [
      'src/lib/manufacturing/drc.test.ts',
      'src/lib/manufacturing/erc.test.ts',
      'src/lib/simulation/multiSheet.test.ts',
      'src/lib/geometry/distance.test.ts',
      'src/lib/geometry/landShape.test.ts',
      'src/lib/demo/demoShowcase.test.ts',
      'src/lib/demo/demoLaptopBoard.test.ts',
    ],
  },
  {
    id: 'board-routing',
    family: 'board',
    title: 'Autorouting and controlled structures',
    modes: ['pcb', 'convert'],
    computes: 'Trace and via geometry per net — differential pairs, BGA fanout, DDR and HDI patterns — as the canonical copper the editor, 3-D view and exports draw.',
    method:
      'Lee breadth-first and bidirectional A* hybrid on a per-layer grid. Cell size is derived from the rules rather than guessed: `routerGridMm` takes the finer of minimum spacing and minimum width, snaps it down to a 0.05 mm step, floors it at 0.05 and caps it at 0.5, because the cell itself is part of the barrier a trace centre faces and a coarse cell closes escape lanes the fab rule leaves open. Nets are ordered by a Manhattan-distance minimum spanning tree, a via penalty is charged for layer changes, and routed cells are marked as obstacles afterwards. Each land reserves its real copper: a rectangle, oval or circle rotated with the part rather than a disc around its bounding box, and a land with a drill reserves every routing layer because the plated barrel runs the full stack. Reservations use two grids, not one — the gap a trace centre line keeps is the rule\'s spacing plus half the track width plus half a cell, since the path runs between cell centres, and the gap a via landing keeps is spacing plus half the annulus, since a landing sits on the centre it was tested at. A net the greedy order cannot thread gets a bounded rip-up pass: the few nets standing in its way are lifted, it is routed, and what was lifted is re-laid; an attempt that leaves anything worse off is rolled back exactly. Pair and DDR rules measure skew and length from the routed polylines.',
    notCovered: [
      'Rip-up is bounded and configurable: `ripUpPasses` sweeps (default 2) and one retry lifts at most `ripUpVictims` earlier nets (default 4). A net boxed in by more copper than that reports itself unrouted rather than spending the session.',
      'The search also records *why* it failed. A net whose region is sealed by land reservations is marked walled and not retried, because lifting copper cannot move a footprint — which is why the laptop mainboard declares `ripUpPasses: 0` and why its misses are named instead of bartered.',
      'The Manhattan heuristic approximates 45-degree routes.',
      'Escape density is grid-limited, not rule-limited: the 90 × 68 mm, 26-net, 0.8 mm-pitch board closes all 26 at 0.3 and at 0.4 mm cells and loses five at 0.5 mm, because a coarser grid cannot resolve two clear lanes inside one fine-pitch escape corridor. `src/lib/demo/demoShowcase.test.ts` sweeps that ladder.',
      'The 245 × 90 mm, 56-part laptop mainboard closes 52 of 66 nets on its two outer films at 0.25 mm cells in about 6 s, measured on the main thread (`routeMs` in `demoLaptopBoard.test.ts`). The fourteen it misses are listed by name in `summary.unrouted` and drawn as ratsnest flylines, not as invented copper; a production board routes those as coupled, length-matched pairs on controlled impedance, which this router does not attempt.',
      'One trace width and one spacing rule for the whole board: no net classes, no per-layer rule sets, and the autorouter pairs nothing — coupled differential geometry is produced by the pair designer and checked, not routed.',
      'HDI routing is a single-layer blocked-cell grid; layer changes are not modelled there, and a microvia that would span more than adjacent layers is refused in favour of a buried or plated through via.',
      'A declared pair impedance is the intent: the geometry that delivers it is checked, not field-solved, and converting skew to time needs the effective permittivity the pair actually rides over.',
      'IBIS parsing is the type and section scanner; no buffer transient is simulated.',
    ],
    validatedBy: [
      'src/lib/manufacturing/autorouter.test.ts',
      'src/lib/geometry/landShape.test.ts',
      'src/lib/manufacturing/diffPair.test.ts',
      'src/lib/manufacturing/bgaFanout.test.ts',
      'src/lib/manufacturing/ddrRouting.test.ts',
      'src/lib/manufacturing/hdiRouting.test.ts',
      'src/lib/manufacturing/stackup.test.ts',
      'src/lib/demo/demoLaptopBoard.test.ts',
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
    computes: 'A three-dimensional board scene and STL/OBJ meshes built from the routed layout — outline, copper layers, poured planes with their clearance keepaways, soldermask in the chosen lacquer colour, ENIG/HASL/OSP pad metal, pads breaking through, vias with their barrels, drills and mask openings, silkscreen and footprint bodies.',
    method: 'One scene geometry builder shared by the renderer and the exporters, so the picture and the mesh come from the same canonical board model rather than a separate demo slab. Mask colour and pad finish select the preview materials; copper and pad geometry are unchanged by them. The footprint category chooses the moulding — a two-terminal chip is a body with end metal on the land axis, a diode adds the cathode band, an LED a lens in its own hue, an IC a pin-1 dimple — and a part\'s own colour chooses the hue inside that family, so four LED colours read as four parts. A part declaring no body height, such as a mounting hole, is drawn as its land and drill alone. Copper is emitted as buffers rather than as one shape per feature: a layer\'s routed traces become one mitred ribbon, its barrels, drills and mask openings one buffer each, and a poured plane is a shared rounded prism that keeps its keepaways as dielectric plugs instead of holes cut through its outline — cutting them is an ear-clipping triangulation of the whole boundary, and on the 56-part mainboard it held the tab for 83 seconds. Repeated shapes and finishes are shared by exact size, the size slider moves a transform instead of rebuilding geometry, and a replaced group releases the buffers it owned.',
    notCovered: [
      'A geometry preview and mesh exporter, not an electromagnetic, thermal or mechanical co-solve.',
      'Mask colour and pad finish are visual choices for the preview; the fabrication package does not encode either, so the fab house will use its own process unless the order says otherwise.',
      'Bodies are built from the declared land pattern and category, not from a vendor 3-D model: the silhouette and terminal metal are to scale, the moulding details are representative.',
      'Keepaways are drawn as the laminate that replaces the copper, so the clearance reads at the plane\'s own height; the void is not a boolean subtraction from the plane, and a section through a pour is not available.',
      'The whole board is one mesh graph at one resolution: a 56-part eight-layer mainboard previews in 1 344 objects and 456 000 triangles, measured in `pcb3dBuildBudget.test.ts`, and there is no level-of-detail or progressive refinement path.',
      'Every warning names the element falling outside the outline instead of silently clamping it.',
      'Degenerate face normals are excluded from STL rather than replaced by a tidy (0,0,1) lie about the geometry.',
    ],
    validatedBy: [
      'src/lib/pcb/pcb3dModel.test.ts',
      'src/lib/pcb/pcb3dBuildBudget.test.ts',
      'src/lib/3d/prismGeometry.test.ts',
      'src/lib/pcb/pcbScene.test.ts',
      'src/lib/3d/exporters.test.ts',
      'src/lib/3d/framing.test.ts',
      'src/__tests__/circuit3DViewer.test.tsx',
    ],
  },
  {
    id: 'board-enclosure-fit',
    family: 'board',
    title: 'Enclosure import and board fit check',
    modes: ['preview3d'],
    computes:
      'An STL or OBJ case shell dropped into the 3-D board preview, drawn around the board, and a fit verdict: cavity size, board stack size, the room left at each of the four walls, the floor and the lid, the tightest side named in words, and the shell\'s own open, non-manifold or reversed edges. A shell that is not a closed solid downgrades the headline from a yes/no to a qualified number. The same verdict is what eda.observe hands an agent.',
    method:
      'The board stack is the union of the outline with every body, pad and via in the scene — the content envelope widened to the board, grown to the tallest feature on either side. The shell is the bounding box and topology already measured by the shared mesh reader. Centres are made coincident and clearance is per-axis: half the box minus the stack extreme on each of the six faces, so the lid number is the gap above the tallest component, not above the laminate. Both sides read one implementation in src/lib/pcb/enclosureFit.ts, and the shell sentence comes from shellProblem in src/lib/3d/meshMeasure.ts — the same words the mechanical viewport prints, so a mesh cannot be a box in one panel and a hole in another.',
    notCovered: [
      'A bounding-box comparison, stated in the panel and in the agent payload. An imported shell has no feature tree, so ribs, bosses, connector cut-outs and a lid that dishes inward are invisible; a pass means the envelope clears the envelope, not that the assembly goes together.',
      'The two are centred on each other by bounding box. The model\'s own origin and any intended offset are not trusted, so a deliberately off-centre board in an asymmetric case is not modelled.',
      'A broken shell is reported as broken: open, non-manifold and reversed edges travel with the clearance numbers instead of being smoothed into a confident answer.',
      'No Y-up/Z-up reorientation: the mesh is read as authored, with Y as the stack direction the board lies along.',
      'The enclosure is context, not copper — excluded from the fab package, DRC, the router and every export, and kept per project so a case brought in for one board does not follow the designer into the next.',
      'Session state: not saved into the project, not versioned, cleared on reload.',
      'The parametric case in the fab export (enclosureStep) builds a shell from declared clearances; this record measures a shell the designer already has. Neither checks the other.',
    ],
    validatedBy: [
      'src/lib/pcb/enclosureFit.test.ts',
      'src/lib/agents/edaTools.test.ts',
      'src/lib/3d/objImporter.test.ts',
      'src/lib/3d/framing.test.ts',
      'src/__tests__/circuit3DViewer.test.tsx',
    ],
  },
  {
    id: 'board-fab-export',
    family: 'board',
    title: 'Fabrication package and STEP geometry',
    modes: ['pcb', 'bom'],
    computes: 'A fab package — every copper film in the declared stackup, outer and inner, net-named plane pours on inner films, masks, silk, Excellon drill with separate blind/buried files, centroid file — behind a fab-profile DRC gate, plus BOM roll-ups and enclosure STEP.',
    method: 'Deterministic writers over the canonical layout, with every routed segment filed on the film it was drawn on, drill emitted as drill rather than as Gerber, a separate drill file per blind/buried span, plane pours as dark Gerber regions with clear-polarity anti-pads around foreign barrels, and a resolved 1 oz vendor profile with laser-via floors when the vendor declares them.',
    notCovered: [
      'Fail-loud by design: a component with no resolvable footprint, an undefined pad, inner copper whose film the package was not told about, a plane that connects to nothing, or a foreign trace routed on a plane film is a violation, never a guess.',
      'Plane pours fill the board rectangle inset 0.3 mm: foreign drilled barrels get an anti-pad, same-net barrels are connected directly rather than through thermal-relief spokes, and the pour does not void itself around board cutouts or over other films\' copper.',
      'The 3-D preview draws a poured plane and its keepaways on the film it was declared on; the 2-D editor canvas still shows routed copper only, so a plane is invisible while laying out.',
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
  {
    id: 'structure-import',
    family: 'structure',
    title: 'STL and OBJ model import and inspection',
    modes: ['mechanical'],
    computes:
      'Parses ASCII and binary STL plus wavefront OBJ uploads, draws the model beside the assembly as a reference, and reports triangle count, size in millimetres, surface area, divergence-theorem volume and a closed-shell check (open, non-manifold and reversed edges) to the panel and to mech.observe.',
    method:
      'Binary layout is confirmed by exact size (84 + 50 bytes per triangle) before any text sniffing, so a binary file whose header begins with "solid" is not misread; OBJ faces are resolved against the vertices defined so far, including negative indices, and polygons are fan-triangulated from the first corner so the ring winding survives. Both readers hand the same triangle soup to one measurement pass: normals are rebuilt from winding rather than trusting stored or zero facet normals, and edges are quantised to the mesh extent and paired to classify open, non-manifold and inconsistently wound boundaries.',
    notCovered: [
      'STL and OBJ only: no STEP, IGES, 3MF or native CAD import. A file named for the wrong reader is refused, not reinterpreted.',
      'Neither format carries a unit system; coordinates are read as millimetres and never rescaled behind the user\'s back.',
      'OBJ texture coordinates, vertex normals, groups, objects and material directives are parsed past, not applied: shading comes from the facet winding and no .mtl is read.',
      'The reference mesh is rendered, framed and measured but is not part of the assembly model: it is excluded from STL/OBJ/GLTF export, from mech.analyze and from every mechanical solver.',
      'Agents see the reference through mech.observe as an envelope and a shell verdict, never as its triangles; the vertex buffers stay in the browser.',
      'The import is session state: it is not saved into the project, is not versioned, and reloading clears it.',
      'The shell walk is skipped above 400,000 triangles and the panel says so; volume is reported only for a closed shell.',
      'No repair: holes, flipped facets and degenerate triangles are reported, not stitched or culled from the mesh.',
    ],
    validatedBy: ['src/lib/3d/stlImporter.test.ts', 'src/lib/3d/objImporter.test.ts'],
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
  {
    id: 'wave-optical',
    family: 'wave',
    title: 'Fibre-optic link budget',
    modes: ['rf'],
    computes:
      'OOK link margin from launch power, fibre, splice and connector loss, a chromatic-dispersion eye-closure penalty, PIN receiver sensitivity at a declared BER, and the achieved photons per bit beside the ideal ln(1/BER) bound.',
    method:
      'Closed-form loss addition; dispersion broadening σ = D·Δλ·L with the stated Gaussian penalty 5·log₁₀(1 + (2π·B·σ)²); receiver sensitivity from the Q-factor equation with shot, dark-current and declared thermal noise. The Q-factor comes from an inverted complementary error function.',
    notCovered: [
      'Fibre attenuation is the declared value at the operating wavelength; there is no wavelength-dependent attenuation model, OH-absorption peak or bend-loss model.',
      'No fibre nonlinearity (SPM/XPM/FWM), polarisation-mode dispersion, amplifier ASE, forward-error correction or receiver equalisation.',
      'The dispersion penalty is a Gaussian estimate, not a waveform, eye-diagram or DSP simulation.',
      'The ln(1/BER) photon figure is an ideal photon-counting bound only; a PIN transimpedance receiver is not a photon counter and sits orders of magnitude above it.',
    ],
    validatedBy: [
      'src/lib/photonics/opticalLink.test.ts',
      'src/__tests__/rfPanel.test.tsx',
    ],
  },
  {
    id: 'wave-quantum',
    family: 'wave',
    title: 'Statevector quantum circuits',
    modes: ['rf'],
    computes:
      'Exact unitary evolution of up to 12 qubits for H, X, Y, Z, S, T, Rx, Ry, Rz, CNOT, CZ and SWAP, with basis and marginal probabilities, ⟨Z⟩ per qubit and sampled measurement counts.',
    method:
      'A dense 2ⁿ complex amplitude vector; single-qubit gates are applied as 2×2 matrices to each pair of basis states, controlled gates permute or phase-flip amplitude pairs, and normalisation is checked rather than assumed. Sampling uses an injectable random source and leaves the state untouched.',
    notCovered: [
      'Noiseless pure-state simulation: no density matrices, noise channels, mid-circuit measurement, error mitigation or hardware calibration.',
      'A sampled measurement is a statistical draw from the simulated distribution, not a hardware run; repeated shots are independent and the stored state is never collapsed.',
      'No pulse-level control, analogue Hamiltonian evolution, variational optimisation or quantum error correction is modelled.',
      'The 12-qubit cap is enforced by refusal; larger registers are not silently approximated.',
    ],
    validatedBy: [
      'src/lib/quantum/statevector.test.ts',
      'src/__tests__/rfPanel.test.tsx',
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
    id: 'machine-grid',
    family: 'machine',
    title: 'Power-grid load flow',
    modes: ['grid'],
    computes:
      'Bus voltage magnitudes and angles, generator and slack injections, branch flows, losses, line loading against a declared rating, and PV reactive-limit enforcement for the declared balanced network.',
    method:
      'Positive-sequence per-unit Y-bus assembled from series impedance, charging susceptance and an off-nominal tap ratio. Polar Newton–Raphson with an analytic Jacobian, flat start, backtracking step-halving line search, and PV-to-PQ conversion when a generator reaches a reactive limit. Radial distribution uses a backward/forward sweep on a validated tree with per-phase constant-power loads.',
    notCovered: [
      'Steady-state positive sequence only: no transient or voltage stability, electromagnetic transients, protection coordination, harmonics or phase imbalance.',
      'Loads are constant power: no ZIP load, motor stalling, transformer saturation or phase-shifting transformers.',
      'A case beyond the transfer limit returns converged: false with the last iterate; it is never presented as a solved low-voltage operating point.',
      'Distribution assumes a balanced radial tree with no shunt capacitance, voltage regulators or conductor thermal model, and refuses a loop instead of approximating it.',
      'No state estimation, contingency screening, economic dispatch or market data.',
    ],
    validatedBy: ['src/lib/power/loadFlow.test.ts', 'src/__tests__/powerGridPanel.test.tsx'],
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
      'Datasheet import synthesizes no SPICE model, because a pinout is not device physics; simulation needs a vendor model card. Its footprint is a generated dual-row land pattern sized from the stated dimensions (narrow body unless the package name ends in W), not a per-part IPC land-pattern calculation, so it is flagged for checking before fabrication.',
      'An unstated package family is reported as assumed rather than presented as read from the document.',
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
      'No daemon entry point ships: the flash frame handler is exercised against a file-backed device in tests, and the companion bridge is a WebSocket client. A deployment must run its own listener on the declared endpoint and open the real device node.',
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
    computes: 'The exact set of CAD calls an agent may make — 15 sheet tools, 9 board tools, 8 mechanical tools — each returning a fresh canonical observation plus an SVG, and a bounded autopilot that scores every iteration and restores the best design.',
    method:
      'Registered tools over the live store (cad.observe, listLibrary, addPart, removePart, movePart, setProperty, connect, disconnect, nameNet, simulate, assess, erc, exportNetlist, setFirmware, undo; eda.simulate, observe, route, editSymbol, movePart, addTrace, addVia, drc, exportFab; mech.observe, addPart, movePart, resizePart, setSupport, setLoad, analyze, autopilot), run through a harness that enforces a call and wall-time budget, approval gates and an audit trail, with a symbolic verifier for ground-truth connection, power-rail, bus-contention and Boolean claims.',
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
      'Local autopilot and the always-on job queue need no server, but they only run while Folio is open. 24/7 or scheduled agents need a server-side runner with a job queue, a sandboxed worker, durable design storage and an authenticated token exchange; until that exists, a missing configuration is reported honestly rather than pretended.',
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
  {
    id: 'agents-voice',
    family: 'agents',
    title: 'Voice conversation',
    modes: ['schematic'],
    computes:
      'A spoken conversation surface: recognition transcripts, intent dispatch onto the live store (place library parts, wire named references, undo/redo, open workspaces, save and export through the shell), spoken replies that state what actually happened, and a bounded on-screen transcript.',
    method:
      'Browser SpeechRecognition for the microphone and speechSynthesis for replies, with restart, quick-end loop detection, barge-in and timeout handling. Intents are matched by keyword bags, pattern templates and example-sentence similarity; add and connect commands use the shipped library, pin world coordinates and the undoable store actions, so a refusal names the available references and claims nothing changed.',
    notCovered: [
      'No audio is recorded or uploaded: recognition runs in the browser speech service and Folio stores only the transcript.',
      'Intents are deterministic keyword matching, not a language model; there is no LLM backend behind voice, and unfamiliar phrasing is answered with guidance rather than guessed.',
      'Placement and wiring act on the schematic workspace; other workspaces respond to navigation and description only.',
      'A spoken reply only ever claims what the handler reported: opening the simulation panel is described as opening a panel, never as running or passing a simulation.',
      'Mic access is a browser permission; a denied or unsupported recogniser is reported as an error and typed commands remain available.',
    ],
    validatedBy: [
      'src/lib/voice/speech.test.ts',
      'src/lib/voice/voiceSession.test.ts',
      'src/lib/voice/conversation.test.ts',
      'src/lib/voice/designActions.test.ts',
      'src/__tests__/voiceConversation.test.tsx',
    ],
  },
  {
    id: 'agents-jobs',
    family: 'agents',
    title: 'Always-on job queue',
    modes: ['agents'],
    computes:
      'A persisted background job queue: a prompt is planned against the live sheet (plan → act → verify → report), runs while the human keeps designing, and can be paused, resumed, cancelled or held for approval. A job interrupted by closing the tab is recovered as paused and resumes from its last completed step.',
    method:
      'FIFO runner over a bounded local-storage queue, with a token-budgeted context pack (goal, parts, nets, issues, transcript) built per job, cooperative pause/cancel between steps, approval gates that pause instead of bypass, per-step persistence with an audit of every tool call, and crash recovery that marks interrupted running jobs as paused with a recovery flag.',
    notCovered: [
      'Always-on means while Folio is open: a closed tab cannot execute anything, and 24/7 execution needs the server-side runner documented in docs/AGENT_CLOUD.md.',
      'Planning is deterministic keyword planning (planEdaFlow), not a language model; a prompt that maps to no plan is refused honestly.',
      'Context-pack token counts are estimates (characters/4), not a tokenizer count, and the pack is a compact summary of the sheet, not the full design.',
      'Approval-required steps (only eda.exportFab among built-in plans) pause the job; the decision is recorded and a denial stops the job.',
    ],
    validatedBy: [
      'src/lib/agents/jobQueue.test.ts',
      'src/lib/agents/contextPack.test.ts',
      'src/lib/agents/jobRunner.test.ts',
      'src/lib/agents/jobExecutor.test.ts',
      'src/__tests__/jobRunnerPanel.test.tsx',
    ],
  },
  // ── platform ───────────────────────────────────────────────────────────────
  {
    id: 'platform-vcs',
    family: 'platform',
    title: 'Version control, projects and undo',
    modes: ['schematic', 'dashboard'],
    computes: 'Content-addressed commits, restore and log per project across domains (schematic, firmware, board, mechanical), the offline project store, backup export and per-keystroke undo.',
    method:
      'Git-like and self-contained: one repository per project id in workspace storage, a commit id being a SHA-256 over its tree with parents and a tree hash. The first commit of a chain is stored whole and later commits as a JSON patch against that parent, falling back to a full copy when the patch is not smaller; every snapshot is reconstructed and hash-checked on load.',
    notCovered: [
      'A corrupted or hash-mismatched record is reported, never served silently as history.',
      'No remote repository, no push or pull, no merge engine or branch federation.',
      'Persistence is workspace storage: clearing the origin clears the history, which is why backup export exists.',
      'The launcher states the revision count stored in this workspace, never a cloud-side history, and a project read that failed is named as a failure with a retry instead of being dressed up as "no projects yet".',
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
      'In-memory event log capped at 10 000 events and an audit trail capped at 50 000 entries, swept on an interval from real recorded state; asset protection uses AES-GCM 256 with PBKDF2 at 100 000 SHA-256 iterations over five roles and a hash-chained audit log. Backup evidence is read from the checkpoint store the app actually writes, and a saved project with no checkpoint newer than 24 hours raises one overdue notice that retires as soon as a newer checkpoint exists.',
    notCovered: [
      'The ISO 27001, IEC 62443, NIST CSF, GDPR and HIPAA entries are heuristic checklist evidence computed from local state, not an audited certification. No GDPR, ISO 27001 or IEC 62443 certification is claimed anywhere in this product.',
      'TLS evidence is derived from whether the page is served over HTTPS; network segmentation is inferred from declared zones. There is no packet capture and no external collector — the traffic arrays are passed in by callers.',
      'Crypto is Web Crypto in this workspace. There is no key management service, HSM or recovery path.',
      'The SIEM surface is design-time audit visibility, not a monitored production SOC with guaranteed delivery.',
      'Backups are the manual project checkpoints: there is no scheduler, so a saved project without a recent checkpoint stays overdue until someone takes one. A workspace with no saved project reports the backup control as not applicable rather than passing it.',
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
    computes: 'Device capability and acceleration-path reporting, and the dispatch that chooses CPU, Worker or WebGPU for a thermal grid and Worker pools for Monte Carlo tolerance sweeps, AC frequency sweeps and noise sweeps.',
    method: 'Adapter probing that resolves every failure mode — no navigator.gpu, no adapter, a denied request, a lost device — to null, after which the caller falls back to the Worker or main-thread path with the same physics. Monte Carlo runs carry per-run seeds derived from the sweep seed, so a pooled run draws exactly what the in-thread run would draw, and the main thread accumulates the returned samples in run order. The AC pool receives the bias, diode conductances and frequency grid solved once on the main thread, solves an independent complex MNA system per frequency, and assembles the returned points in sweep order. The noise pool receives the bias, output node and source densities computed once on the main thread, runs the transposed-MNA adjoint solve for each frequency and assembles the spectrum in the same order.',
    notCovered: [
      'It never advertises an acceleration path that the dispatch code cannot execute.',
      'Thermal grids can use WebGPU or a Worker; Monte Carlo, AC and noise sweeps use a Worker pool. Every other analysis is CPU-first and in-thread.',
      'The pools change where the runs execute, not what they compute: pooled Monte Carlo statistics, pooled AC responses and pooled noise spectra are identical to the in-thread results. They do not parallelise a single circuit solve, whose Newton iteration, transient integration and DC sweep are sequential.',
      'A worker pool is not automatically faster. It keeps the sweep off the main thread; whether wall-clock time improves depends on circuit size and hardware, and a small sweep stays in-thread below the threshold.',
      'A panel that reports a speed-up without measuring one would be a claim, so the panel reports the device state instead.',
    ],
    validatedBy: [
      'src/lib/acceleration/webgpuDevice.test.ts',
      'src/lib/acceleration/acceleratedSimulation.test.ts',
      'src/lib/acceleration/monteCarloDispatch.test.ts',
      'src/lib/acceleration/acSweepDispatch.test.ts',
      'src/lib/acceleration/noiseSweepDispatch.test.ts',
    ],
  },
  {
    id: 'platform-admin',
    family: 'platform',
    title: 'Administration, quotas and usage',
    modes: ['dashboard', 'siem'],
    computes: 'The administration console view of users, roles, quotas and usage, with an append-only workspace usage ledger.',
    method:
      'Cloud mode reads the profiles table from the admin migration; standalone mode has exactly one principal, the workspace administrator. Quotas are evaluated as policy from the role table, and the workspace ledger aggregates deterministically.',
    notCovered: [
      'A limit of null means unlimited and the owner is always unlimited, so a workspace can never lock itself out of administration.',
      'When the cloud schema is absent or unreachable the console says so instead of rendering a made-up user list, and it labels cloud-only capabilities without faking invitations.',
      'The ledger is confined to this workspace and is not an analytics pipeline; mirroring to the cloud table is best-effort and only in a configured deployment, and a failed mirror never breaks the design action it was recording.',
      'The guided tour counts itself honestly: a card closed before the last step is recorded as an exit carrying the number of steps actually opened, and only reaching the end — or taking the register hand-off there — is recorded as a finished tour.',
      'Console numbers are this workspace ledger, not a billing system.',
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
      'control', 'machines', 'grid', 'rf', 'hdl', 'icdesign', 'fpga',
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
      'Tutorial progress is stored in this workspace only, and a cleared or blocked storage loses it rather than syncing it.',
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
