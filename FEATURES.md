# Folio — Feature Documentation

> **Honesty note:** every feature below exists in the codebase today. Markers:
> ✅ = implemented and covered by automated tests · 🟡 = implemented at UI level
> or requires an optional external service. Counts come from `npm test`.

## 🧭 Demo Gallery & Workspace Navigation ✅

- **Demo gallery**: 31 runnable scenarios — at least one per workspace mode —
  searchable by title, summary or analysis name and filterable by family.
  Open with the header **Demos** button or **Ctrl/⌘+Shift+D**.
- **One proven board across domains**: the half-wave rectifier demo seeds the
  schematic, transient analysis, PCB, autorouted 3-D scene, BOM audit, HIL suite
  and digital twin from the same component and wire data. PCB traces come from
  the A* router (all four nets), not a fixed slab.
- **Grouped workspace navigation**: 25 modes organised into Design, Electrical,
  Mechanical and Operations families, each with an icon and description, replacing
  a single 25-tab ribbon.
- **Command palette**: **Ctrl/⌘+K** searches every workspace, every demo and
  document actions (save, theme, gallery, limits register) with arrow-key
  navigation.
- **Contextual status bar**: mode description, schematic metrics when on the
  sheet, theme and unsaved state everywhere; a **DEMOS** shortcut and a
  **LIMITS** entry that opens the capabilities register. Readouts are
  prioritised by width rather than clipped on narrow viewports.
- **Responsive workstation shell**: palettes dock beside the sheet at ≥1280 px
  and become scrim-backed drawers below it, so the canvas keeps a usable width.
  Secondary header tools collapse into a **More** menu, and the tab rail
  auto-scrolls the active workspace into view.
- **Tests**: gallery loading/filtering/Escape, palette filtering/keyboard
  execution, scenario coverage of all 25 modes, routed-board geometry, compact
  header menu routing, drawer dismissal and the limits-register filters.

## 🎯 Schematic Editor ✅

- **Placement**: click-to-arm or drag from the 39-part library, grid snap, rulers
- **Wiring**: click-to-click routes, junctions, net labels, wire tool, delete tool
- **Selection & editing**: properties inspector, reference designators, pin table,
  position/rotation, arbitrary SPICE attributes added or removed per part,
  undo/redo, autosave
- **Symbol editor**: right-click a part to edit its body size, SVG outline paths
  and pin table with a live preview; the shared symbol contract gates the save,
  and an edit applies to every instance of that library part
- **Multi-sheet**: global-label stitching, duplicate-reference rejection
- **Interchange**: KiCad netlist import/export with round-trip tests
- **Sketch mode** (press `S`): draw with a pen, finger or mouse. Strokes are
  captured in sheet coordinates, matched offline against templates generated
  from the shipped library symbols (resistor, capacitor, inductor, diode,
  ground, source, junction) at four quarter turns, previewed with confidence,
  then placed as ordinary parts and wires (`Ctrl+Enter`). Parts land at library
  size — the sketch sets position and rotation, not scale — and wire ends snap
  to real pins. Undo steps through ink before it touches the design. Unread ink
  is reported, never guessed; four quarter turns only
- **Image import**: a PNG/JPEG/WebP/SVG of clean line art is thresholded
  (Otsu), thinned and skeleton-walked into strokes, then recognised by the same
  engine. Perspective, shading and pencil texture are not corrected, so a
  photographed sketch may trace poorly — the panel says so

## ⚡ Simulation Engine ✅

- **Analyses**: DC operating point, DC sweep, transient, AC, noise, Monte Carlo —
  all wired into the simulation panel
- **Analog solver**: MNA stamping, 51 validated semiconductor models, behavioral
  sources, transmission lines, transformers
- **Transient integration**: backward Euler (default, monotone), trapezoidal, or
  Gear/BDF2 (second-order, damping), with backward-Euler startup/restart and
  adaptive subdivision
- **Digital logic**: four-state event simulation (gates, flip-flops, clocks,
  X propagation, loop detection) runnable from the panel
- **Mixed-signal**: lockstep bridge between digital events and analog PWL sources
- **Netlists and decks**: SPICE deck export; import of SPICE decks (`.cir`, `.sp`,
  `.ckt`) covering R/C/L/V/I/D/Q/M/J/E/G/B/S/W/T/K elements, PULSE/SIN/EXP/SFFM/PWL
  sources, `.model` cards and `.op`/`.dc`/`.tran`/`.ac`/`.noise` cards, solved on the
  same engine as the drawn sheet. Subcircuits, `.include`/`.lib`, `.param`
  expressions and F/H sources are refused by name, with the offending line
  reported; a deck with several analysis cards solves the first and says which
  cards it did not run.
- **Waveforms**: charts with probes, measurements, and playback
- **Chart interaction**: drag to zoom a window, shift-drag to pan, wheel to zoom
  under the pointer, click to pin a cursor, `+`/`-`/arrows/`R` from the keyboard.
  Zoomed windows snap onto solved samples and the readout prints those samples,
  so a pinned cursor never reports an interpolated guess. Shared by the circuit,
  control-systems, electric-machine and RF-filter plots
- **Truth checks**: solver outputs compared against independently computed
  reference equations in the test suite

## 🎛 Control Systems & Electric Machines ✅

- **Linear control**: transfer-function algebra (series, parallel, feedback),
  Durand–Kerner polynomial roots, pole/zero stability classification,
  controllable-canonical state space, RK4 time simulation, step/impulse metrics,
  log-spaced Bode magnitude and unwrapped phase, gain/phase margins, Nyquist,
  and controllability/observability ranks. The **Control** workspace panel drives
  a plant plus optional PID and plots closed-loop step and Bode responses
- **PID**: filtered derivative, unit-feedback loop, derivative-on-measurement,
  output clamping and conditional-integration anti-windup
- **Brushed DC motor/generator**: two-state armature model stepped with a
  zero-order-hold matrix exponential (result independent of the output sample
  interval), load/generator torque conventions, terminal-voltage and efficiency
  reporting
- **BLDC/PMSM**: dq model with ideal FOC decoupling
- **Stepper**: sinusoidal holding torque, first-order phase-current lag, detent
  and lumped damping, with RK4 substepping sized from the electrical and
  mechanical time constants
- **Machines panel**: steady-state operating points and time-domain speed,
  current, torque, power, dq and rotor-position traces

## 🖥 PCB Design & Manufacturing ✅

- **Layout**: editable rectangular board outline (width/height inputs and drag
  handles), multi-layer stack, traces, vias, pads, layer toggles, interactive
  canvas
- **3-D preview**: the viewer renders the routed layout itself — actual outline,
  per-layer copper, via barrels, footprint pads and component bodies — and the
  same geometry feeds STL/OBJ export. Off-board traces, vias and parts are
  reported as warnings rather than silently clamped
- **Conversion & routing**: schematic-to-PCB placement and constrained autorouting
- **Cross-selection**: picking a part on the sheet highlights it on the board and
  picking a part on the board selects it on the sheet — both views read and write
  the same selection, so the highlight also survives a workspace switch. On the
  board, the selected part's nets stay lit while other copper and vias recede;
  if those nets have no routed copper yet, nothing dims
- **Board selection and group moves**: Shift-click adds or removes a part and a
  rubber band on empty board selects every footprint it touches (Shift extends);
  dragging any selected member moves the whole group with the grabbed part on
  the snap grid, and one drag is one board undo step. The middle button pans
  without touching the selection, and the rubber band is drawn clipped to the
  board outline
- **Tool rail**: board tools are labelled and grouped by intent — Inspect, Route
  and Layout — with part edits and history in their own groups; the active tool
  is tinted and the rail states what its next gesture does and which modifier it
  reads, so a tool is chosen by name rather than a memorised icon
- **Outline, keep-outs and measuring**: the outline tool drags the right, bottom
  or corner handle (origin fixed, 10–500 mm, rectangle only); the keep-out tool
  draws a copper-free window on all copper layers or, with Alt, the active layer,
  and DRC and the router both read that same rectangle — DRC measures each
  named layer, while the router bars its two routed films and any via, because a
  barrel crosses the stack; the measure tool reads the straight-line distance and
  Δx/Δy between two land- or grid-snapped points. Measurements are session-only
  and are not stored in the design
- **Checks**: DRC (clearance, width, drill, annular ring, copper inside a drawn
  keep-out, and copper crossing the rectangular outline) and ERC (unconnected
  pins by pin type, multi-driver nets, power/ground shorts, and a warning when a
  net joins only inputs with no driver)
- **Thermal**: 2-D finite-volume steady-state solver with convection on both
  faces; shared CPU/Worker/WebGPU physics, hotspot and converged status
- **Signal integrity**: single-line microstrip/stripline Z₀, reflection lattice,
  trace-width optimisation for a target impedance, and a pattern-driven eye
  diagram (ISI, rise time, reflection overshoot) computed from a routed trace
  plus declared stackup/driver assumptions (no crosstalk)
- **EMC**: closed-form trace/loop and cable emission estimates against CISPR
  limits at 3 m — not a chamber measurement or full-wave solve
- **Advanced rules**: multilayer stackup, differential pairs measured off the
  routed copper (closest edge gap, parallel length, skew converted at each
  pair's own effective permittivity, group match window the engineer declares —
  no field solve of the target differential impedance), BGA fanout, power
  integrity, DDR constraints, HDI routing. BGA fanout is a dog-bone via
  proposal for one 256-ball study and is not committed to the board copper; HDI
  checks a microvia layer span and routes on a single-layer grid without layer
  changes; IBIS uploads parse pins, models, C_comp and clamp I-V tables (no V-T
  ramp, no transient buffer), and the eye remains a closed-form lattice
- **Fabrication**: Gerber RS-274X copper film per declared layer (inner films
  included), masks and silk, Excellon drill with separate blind/buried span
  files, centroid/PnP, BOM, JLCPCB DRC gate, and enclosure STEP export. An
  inner film can be poured as a named net's plane: foreign drilled barrels get
  anti-pads, same-net barrels are flashed directly, and a plane with nothing to
  connect is refused
- **Encrypted export**: AES-GCM-256 project snapshots with PBKDF2 key derivation

## 🧮 Compute Acceleration ✅ (thermal, Monte Carlo, AC and noise)

- **Capability probe**: reports WebGPU adapter, Worker support, shared memory,
  the recommended thermal path, and the Monte Carlo, AC and noise sweep worker
  counts in the System Dashboard
- **Three real thermal paths**: WebGPU WGSL Jacobi, Web Worker, main-thread SOR
- **Parallel Monte Carlo**: up to four Workers for sweeps of 32 runs or more.
  Each run seeds itself from the sweep seed and its run index, and the main
  thread accumulates samples in run order, so the pooled statistics are
  identical to the in-thread sweep. A worker fault falls back to the CPU
- **Parallel AC sweeps**: above 64 frequency points the sweep is split across up
  to four Workers. The bias, diode conductances and frequency grid are prepared
  once, each worker solves independent frequency points, and the main thread
  assembles them in sweep order, so the response is identical to the in-thread
  sweep. A worker fault falls back to the CPU
- **Parallel noise sweeps**: above 32 frequency points the adjoint (transposed
  MNA) solve for each frequency runs across up to four Workers. The bias,
  output node and thermal/shot source densities are prepared once, every worker
  uses the same bias, and the main thread assembles the spectrum in sweep
  order, so the result is identical to the in-thread sweep. A worker fault falls
  back to the CPU
- **Scope**: the accelerated paths cover the PCB steady-temperature grid, Monte
  Carlo tolerance sweeps, AC frequency sweeps and noise sweeps. No circuit solve,
  EM, HDL or trajectory workload is GPU- or FPGA-executed, and transient
  integration, DC sweeps and a single Newton solve are not parallelised
- **Correctness gate**: GPU output is accepted only when the shared residual
  converges; otherwise dispatch falls back and reports the path that succeeded
- **Browser-verified**: GPU and CPU peaks/averages agree within 0.01 °C on tested
  boards (50×50 and 100×80 grids)

## 🤖 Robotics, Mechanical & 3D ✅ / 🟡

- **Mechanical**: shared material catalogue, support-aware Euler–Bernoulli beam
  analysis (cantilever or simply supported; axial force affects stress only),
  deflection, stress, modal frequencies, buckling, assembly transforms, AP214
  STEP export (one closed shell per component through the shared geometry
  writer), constrained particle-swarm section sizing with closed-form
  re-verification. Reduced-order multiphysics alongside the beam: steady
  1-D conduction, axial bar and pin-jointed truss, 2-D electrostatic fields,
  air-standard and ideal Rankine cycles, Darcy–Weisbach pipe flow and tree pipe
  networks, Sabine/Eyring room acoustics and mass-law partition TL, and
  psychrometric zone cooling loads (Buck saturation curve, ASHRAE humidity
  ratio/enthalpy/specific volume, bisection dew point and wet bulb) with a
  sensible/latent balance, SHR, supply airflow and equivalent round-duct size.
  Air-standard cycles assume constant specific heats and no pressure loss; the
  Rankine table is nominal saturated water at 0.05–100 bar. Psychrometric loads
  are steady sizing estimates, not a certified Manual J or ASHRAE calculation.
  Not a 3D FEM/CFD solver, and plates are analysed as beams (🟡)
- **3D**: Three.js circuit/PCB viewer, mesh printability metrics, STL export, and
  real FDM slicing to G-code (contours with hole orientation, clipped infill,
  solid shells, raft/brim/skirt, relative volumetric extrusion). Limits: single
  perimeter path, no support generation, FDM only — unsupported requests fail
  loudly instead of emitting wrong toolpaths. XR preview entry point
  (🟡 browser/device dependent)
- **STL and OBJ import** in the mechanical viewport: ASCII and binary STL are told
  apart by exact binary layout (84 + 50 bytes per triangle), so a binary file
  whose header begins with "solid" still reads correctly, and OBJ faces resolve
  against the vertices defined so far (negative indices included) with polygons
  fan-triangulated from the first corner. The upload is rendered beside
  the assembly, framed with it, and measured by one shared pass: triangles, size
  in millimetres, surface area, divergence-theorem volume and a closed-shell
  check that distinguishes open, non-manifold and reversed edges. Neither format
  has a unit system, so coordinates are read as millimetres; OBJ texture
  coordinates, vertex normals and materials are parsed past, not applied;
  nothing is repaired, the reference is session state (never saved into the
  project, dropped when the project changes)
  and is excluded from STL/OBJ/GLTF export and from the solvers, while
  `mech.observe` gives an agent its millimetre envelope and shell verdict — not
  its triangles. The shell walk is
  skipped — and says so — above 400,000 triangles (🟡 import and inspect, not
  STEP/IGES)
- **Enclosure fit in the PCB 3D preview**: an STL or OBJ shell is drawn
  translucent around the routed board, its seams traced so it reads as a case and
  not as fog, and the camera refits so the whole shell stays on screen with the
  board. Measured against it by the same reader
  and the same fit code the panel shows. The board stack is the outline widened
  to every body, pad and via, so lid clearance means the gap above the tallest
  component; the verdict names the offending side ("6 mm past the left wall")
  and reports cavity size, stack size and clearance on all six faces. Bounding
  boxes centred on each other, stated in the UI and in the agent payload: ribs,
  bosses and cut-outs inside the shell are not measured, and the model's own
  origin is not trusted. Open, non-manifold and reversed edges travel with the
  numbers instead of being smoothed over — an open shell turns the headline into
  a qualified number, in the same words the mechanical viewport prints and the
  agent payload carries; with no routed layout the shell is
  drawn and the fit is refused, not guessed. `eda.observe` returns the verdict
  without the triangles, and the shell never enters the fab package, DRC, the
  router or any export (session state, per project)
- **Robotics**: forward/inverse kinematics with damped least-squares IK
  (current-pose seed, deterministic multi-start retry, joint-limit clamping),
  analytic velocity/acceleration trajectory records, task simulation that
  rejects non-monotonic timestamps, out-of-limit or non-finite waypoints and
  empty tasks, tool-point collision against box/sphere/cylinder obstacles, a
  sample-density-independent dimensionless-jerk smoothness score that reports
  no value below four samples, joint
  framing, mechanism replay of planned profiles from explicit start poses or
  commanded velocities, advanced robotics panel, digital-twin demo, numerical
  Lagrangian dynamics (Jacobian mass matrix, gravity, Coriolis/centrifugal,
  energy, conditioning; unsupported joints/state rejected explicitly). Links
  are not swept and there is no friction, motor, flexible-body, or narrow-phase
  collision modelling (🟡 not a certified dynamics sign-off)
- **RF**: antenna and filter synthesis with a dedicated workspace panel;
  numerically integrated dipole/monopole directivity and an optimiser that
  refuses unreachable targets. The same panel carries radio link budgets with
  ITU-R atmospheric/rain loss and NR/6G numerology, an OOK fibre link budget
  (declared attenuation, Gaussian dispersion penalty, PIN sensitivity from the
  Q-equation, photons-per-bit against the ideal bound), and exact statevector
  quantum circuits up to 12 qubits with sampled measurement counts ✅

## 💻 HDL, FPGA & IC ✅

- **HDL**: VHDL and Verilog subsets with parsers and fail-loud diagnostics,
  logic synthesis, FPGA flow helpers
- **IC**: flow adapters, standard-cell library, silicon floorplanning, GDS export,
  chip packaging models

## 🔌 Embedded & Hardware ✅ / 🟡

- **Interfaces**: simulated I²C, SPI, UART, CAN manager APIs (unit-tested)
- **Firmware**: Intel HEX parse/serialize, firmware artifacts, board bring-up;
  schematic-driven Arduino/ESP32 sketch generation (pin/net macros, sensor
  reads, peripheral drive) packaged into a flashable Intel HEX image
- **Programming**: STK500v1 upload over WebSerial with read-back verification
  (live when a port is granted, honest refusal otherwise); fails closed outside
  Node for browser-side toolchain steps
- **HIL**: scenario UI and hardware-in-the-loop panel (render-tested)
- **IIoT / digital twin**: twin synchronization and fleet dashboards 🟡

## 🧠 AI, Agents & Automation ✅ / 🟡

- **aiService**: component recommendations, circuit analysis, and design
  suggestions from deterministic keyword/threshold heuristics — no model or
  network call is made, so answers are advisory, not predictions ✅
- **AI chat panel**: conversational UI over those heuristics, with confidence
  metadata and feedback
- **Agents**: EDA tool harness with per-call budgets, approvals and an audit
  trail, plus a deterministic autopilot. The Assistant plans from keyword rules,
  not a hosted model, and the cloud runner is a transport contract only
- **Datasheet importer** (text, Markdown and CSV — PDF is refused): extracts
  pins, ratings and package, then synthesizes a symbol and a generated dual-row
  land pattern. It deliberately synthesizes no SPICE model — a pinout is not
  device physics — and marks an unstated package as assumed. Plus the **plugin
  marketplace** panel. The marketplace is a local registry of permission-gated
  manifests; plugin-declared tool bodies have no runtime, and nothing is fetched
  from a hosted store
- **Optimisation**: evolutionary/multi-objective helpers and seeded particle-swarm
  section sizing (unit-tested, deterministic per seed)
- **Voice conversation**: a spoken command surface (microphone toggle, `Ctrl+Shift+M`)
  that places library parts, wires named references, undoes, opens workspaces and
  describes the sheet, with spoken replies that state what actually happened.
  Recognition and synthesis run in the browser speech service — no audio is
  recorded — intents are deterministic keyword matching, not a model, and a
  refusal always says the sheet is unchanged
- **Always-on job queue** (Always-on tab): a persisted FIFO queue of engineering
  jobs that plan against the live sheet (plan → act → verify → report) and run in
  the background while the human keeps designing, with pause, resume, cancel,
  per-step progress and approval gates that pause instead of bypass. Each job
  records its token-budgeted context pack (goal, parts, nets, issues, transcript —
  a chars/4 estimate). Honest scope: jobs run while Folio is open; a closed tab
  recovers the active job as paused, and 24/7 execution needs the server-side
  runner documented in `docs/AGENT_CLOUD.md`

## 🗂 Projects, Collaboration, Plugins & Security ✅ / 🟡

- **Offline-first projects**: create/open/save/delete, autosave, dirty state
- **Version history**: content-addressed commits of the whole project — schematic,
  routed PCB, mechanical assembly, firmware and every CAD domain — with diff,
  branch, tag, three-way merge and restore. Stored locally per device ✅
- **Cloud (optional)**: Supabase auth and project persistence when configured 🟡
- **Sharing & roles**: owner/admin/editor/reviewer/viewer with permission checks
  and collaborator management (`collaborationService` tests)
- **Real-time**: Supabase Realtime presence and operation broadcast when
  configured; local-only otherwise. Presence and broadcast are reported apart — a
  failed presence track says peers may not see you instead of claiming a healthy
  session 🟡
- **Plugins**: manifest validation, declared-permission gating, lifecycle hooks,
  marketplace install/uninstall (unit-tested); not a security sandbox
- **Asset security**: RBAC grants, AES-GCM-256 encryption/decryption, in-session
  audit trail (unit-tested)
- **Backup evidence in SIEM**: the health check reads the real checkpoint store.
  A saved project with no checkpoint newer than 24 h opens one "Backup overdue"
  alert; its "Back up now" action takes a checkpoint and retires the notice, and
  the notice also clears on its own when a newer checkpoint already exists. A
  workspace with no saved project reports the backup control as not applicable
  rather than failing it. Alerts not derived from a live condition can be
  resolved from the panel
- **Encrypted export** wired into the app export menu

## 🛡 Administration & Governance ✅ / 🟡

- **Separate surface**: `/admin` opens without a project and is deliberately not
  a CAD mode; the shield button appears in the project list, IDE toolbar and
  More menu
- **Access check**: local mode resolves the device owner; cloud mode requires an
  active `profiles.role` of owner or administrator
- **People**: list accounts and roles, promote/demote, suspend/restore, with
  self-demotion and self-suspension refused; invitations require a service-role
  function and are labelled as not shipped
- **Usage ledger**: append-only, 5,000-event device ledger (3-second duplicate
  collapse, backdated events preserved) covering workspace/demo opens, projects,
  VCS commits, exports, solver runs, agent runs, onboarding and admin opens;
  7/14/30/90-day windows, filters, CSV export and per-workspace totals
- **Quota policies**: owner/administrator unlimited, engineer 100 projects /
  200 exports / 1,000 simulations per day, viewer 3 / 20 / 50; browser checks
  before project creation, exports and solver runs, plus Postgres triggers in
  cloud mode; storage is reported as advisory 🟡
- **Cloud governance schema**: `profiles`, `usage_events`, `quota_policies` with
  RLS, SECURITY DEFINER role helpers, profile-change guards, new-user trigger and
  quota triggers; first owner is promoted once with the service role
- **Environment report**: deployment mode, always-on runner capability, browser
  storage estimate, ledger size and per-mode capability labels
- **Tests**: ledger, policy parsing/enforcement, service access paths, console
  render flows, `/admin` deep link and routing isolation

## ⚙️ Settings, Theming & Accessibility ✅

- **Themes**: light, dark, high-contrast, system preference, migration of retired
  theme names
- **Units & behavior**: metric/imperial, animation toggle, autosave interval,
  onboarding replay
- **Guided tour**: thirteen-step first-run walkthrough with an animated spotlight —
  pulsing halo, viewfinder brackets and a caret aimed at the control each step
  describes — that follows real controls across workspaces, reveals the component
  library, and persists or resumes progress. Gesture steps (wiring, chart zoom,
  3D orbit) stay live so you can try them mid-tour; the rest are modal. Keyboard
  arrows, Esc, clickable step dots, tab trapping and reduced-motion support. The
  card offers to create a project for as long as no design is open, docks in the
  corner that keeps its target visible rather than covering it (folding its
  checklist on short windows), and a guide closed early is recorded as an exit
  counting the steps actually opened.
  The final step hands off to the limits register instead of a completion screen.
- **Accessibility**: keyboard-operable toolbars; every icon-only button must have
  an accessible name, enforced by `npm run a11y:buttons` in CI
- **Language selector**: preference stored; English strings only today 🟡

## 🎓 Help, Guides & Tutorials ✅

- **CAD-style hover help**: resting on a tool-rail button, header control,
  workspace family or workspace tab raises a delayed (550 ms) one-line
  description with its keycap. Focus opens it immediately; Escape, scroll or a
  pointer leave dismisses it. Placement is computed against the trigger and the
  viewport, flips to whichever side fits and clamps on tiny windows, and the
  trigger only carries `aria-describedby` while the tooltip is open.
- **Help centre** (**F1**, **?**, the header help button or the workspace
  **Guide** button): searchable tabs for tutorials, a guide to all 25
  workspaces, the control reference and the shortcut table. It reads the same
  description registry as the tooltips, so a control cannot be explained one way
  on hover and another way in the guide; workspace guides show their capability
  record count so a result can be bounded before it is trusted.
- **Seven hands-on tutorials**: rectifier → transient → PCB → 3D → BOM, control
  and the ML/heuristic toolbox, RF filters, two-link robotics, the mechanical
  enclosure, HDL/FPGA/IC, and the agent verifier. Each starts from a real demo
  board, switches workspace per step, names the actual buttons to press and what
  should become visible. Progress is stored per tutorial in this browser and
  resumable. **Steps are self-checked: the app does not watch the screen or grade
  the result**, and the copy says so.
- **Guided demos**: demos that a tutorial is built on carry a **Guided** chip in
  the gallery with a one-click **Guided** action, so discovery and walkthrough
  cannot name different boards. Tests fail if a tutorial cites a missing demo or
  workspace.
- **Tests**: tooltip timing, focus/dismiss behaviour and placement maths; help
  centre search and tabs; tutorial integrity (real demo ids, real modes, step
  copy) and runner progress; the shell's header and F1 entry points.

## 🛠 Quality Infrastructure ✅

- **Capabilities and limits register**: `src/lib/workspace/limitsRegistry.ts`
  holds one record per family of results — what it computes, the numerical or
  analytical method in the source, the test files that pin it, and an explicit
  list of what is not modelled, refused, or unproven. The **LIMITS** dialog
  renders that file rather than restating it, so an in-app claim and the registry
  cannot diverge. Integrity tests fail the build if a cited test file is missing,
  if a workspace mode is named by no record, if a record states no method or no
  limits, or if a positive claim says "guaranteed", "certified", "zero errors" or
  "always correct". Cloud-gated records carry a **cloud** marker.
- **CI**: lint (zero warnings), typecheck (app + build config), button-label
  audit, full test suite, production build
- **Tests**: 2,581 tests across 251 files, including engine truth tests and React
  render/integration tests
- **Build**: heavily code-split; feature panels and vendor chunks load on demand

## ❌ Not implemented

- A certified multi-user backend beyond optional Supabase persistence/realtime
- A plugin security sandbox (permission checks only)
- UI translations (selector exists; strings do not)
- Classroom management, automated grading, or a public REST API
- GDPR / ISO 27001 / IEC 62443 certifications or end-to-end encryption claims
- Certified numerical sign-off for fabrication or safety-critical control
- Sparse/parallel circuit solving, variable-order Gear/BDF, or
  foundry-validated device-model certification
- Crosstalk, IBIS transient, or full-wave EM analysis
- 3-D FEA, CFD, or contact solvers for mechanical and thermal work
- Quantum-electronic device/transmon physics, photonic waveguide/laser design,
  detailed room/structural acoustics (only the diffuse-field Sabine/Eyring
  estimate is present), avionics flight dynamics, and process-plant flowsheet
  simulation — these are not domains in the workbench today and are not
  represented by placeholder panels. HVAC is present only as the steady
  psychrometric zone estimate described above, not a full load or duct design.
- Nano/micro-scale TCAD, atomistic or molecular dynamics, and multi-scale
  coupling between them and the board-level tools
- A general cross-domain optimiser that jointly sizes electrical, mechanical,
  thermal and control variables under coupled constraints

This document tracks what Folio actually is: a browser-based, offline-first
engineering workbench for circuits, PCB, mechanical, robotics, RF, embedded work
and deployment administration, with tested simulation and manufacturing
toolchains.
