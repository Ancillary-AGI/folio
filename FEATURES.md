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
  Mechanical and Ops & AI families, each with an icon and description, replacing
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
- **Multi-sheet**: global-label stitching, duplicate-reference rejection
- **Interchange**: KiCad netlist import/export with round-trip tests

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
- **Netlists**: SPICE deck export and import
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

- **Layout**: editable board outline (width/height), multi-layer stack, traces,
  vias, pads, layer toggles, interactive canvas
- **3-D preview**: the viewer renders the routed layout itself — actual outline,
  per-layer copper, via barrels, footprint pads and component bodies — and the
  same geometry feeds STL/OBJ export. Off-board traces, vias and parts are
  reported as warnings rather than silently clamped
- **Conversion & routing**: schematic-to-PCB placement and constrained autorouting
- **Checks**: DRC (clearance, width, drill, annular ring) and ERC
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
  integrity, DDR constraints, HDI routing
- **Fabrication**: Gerber RS-274X, Excellon drill, centroid/PnP, BOM, JLCPCB DRC
  gate, and enclosure STEP export
- **Encrypted export**: AES-GCM-256 project snapshots with PBKDF2 key derivation

## 🧮 Compute Acceleration ✅

- **Capability probe**: reports WebGPU adapter, Worker support, shared memory,
  and the recommended thermal path in the System Dashboard
- **Three real thermal paths**: WebGPU WGSL Jacobi, Web Worker, main-thread SOR
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
  re-verification. Reduced-order beam model — not a 3D FEM solver, and plates
  are analysed as beams (🟡)
- **3D**: Three.js circuit/PCB viewer, mesh printability metrics, STL export, and
  real FDM slicing to G-code (contours with hole orientation, clipped infill,
  solid shells, raft/brim/skirt, relative volumetric extrusion). Limits: single
  perimeter path, no support generation, FDM only — unsupported requests fail
  loudly instead of emitting wrong toolpaths. XR preview entry point
  (🟡 browser/device dependent)
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
  refuses unreachable targets ✅

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
- **Agents**: EDA tool harness and symbolic verifier
- **Datasheet importer** and **plugin marketplace** panels
- **Optimisation**: evolutionary/multi-objective helpers and seeded particle-swarm
  section sizing (unit-tested, deterministic per seed)

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
- **Guided tour**: eleven-step first-run walkthrough with an animated spotlight —
  pulsing halo, viewfinder brackets and a caret aimed at the control each step
  describes — that follows real controls across workspaces, reveals the component
  library, and persists or resumes progress. Gesture steps (wiring, chart zoom,
  3D orbit) stay live so you can try them mid-tour; the rest are modal. Keyboard
  arrows, Esc, clickable step dots, tab trapping and reduced-motion support. The
  final step hands off to the limits register instead of a completion screen.
- **Accessibility**: keyboard-operable toolbars; every icon-only button must have
  an accessible name, enforced by `npm run a11y:buttons` in CI
- **Language selector**: preference stored; English strings only today 🟡

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
- **Tests**: 2,119 tests across 212 files, including engine truth tests and React
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
- Quantum-electronic device/transmon simulation, photonic waveguide/laser
  design, room/structural acoustics, HVAC psychrometric load design, avionics
  flight dynamics, and process-plant flowsheet simulation — these are not
  domains in the workbench today and are not represented by placeholder panels
- Nano/micro-scale TCAD, atomistic or molecular dynamics, and multi-scale
  coupling between them and the board-level tools
- A general cross-domain optimiser that jointly sizes electrical, mechanical,
  thermal and control variables under coupled constraints

This document tracks what Folio actually is: a browser-based, offline-first
engineering workbench for circuits, PCB, mechanical, robotics, RF, embedded work
and deployment administration, with tested simulation and manufacturing
toolchains.
