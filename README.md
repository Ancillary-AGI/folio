# Folio — Multi-Domain Engineering Workbench

Browser-based, offline-first engineering workbench for electronic CAD, mechanical
design, simulation, robotics, and embedded development. Everything runs locally
unless you explicitly configure a backend; no account is required for local use.

**Status:** active development. Lint, both typechecks, 2,166 tests across 216
files, the icon-button accessibility audit, and the production build all pass.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5174 (strict port)
```

Optional integrations (the app boots without them):

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

With no Supabase configuration the workbench is fully local: projects, version
history, sharing metadata, and autosave use the browser. The AI panel is a local
rule-based assistant (keyword matching, declared-property estimates and threshold
rules); it makes no model or network call, and its output is advisory.

---

## What actually works

### Demos and navigation

- **Demo gallery** (header **Demos**, or **Ctrl/⌘+Shift+D**): 31 runnable
  scenarios covering every one of the 25 workspace modes, searchable and grouped
  by family. A scenario seeds the stores or stages a one-shot request for the
  panel that owns the feature, so the demo exercises the real engine rather than
  a screenshot.
- The half-wave rectifier demos share one board: schematic → transient → PCB →
  autorouted 3-D scene → BOM audit → HIL → digital twin.
- **Grouped workspaces**: Design, Electrical, Mechanical and Ops & AI families
  with icons and descriptions instead of a flat tab ribbon.
- **Clean, linkable routes**: `/projects/:id/pcb`, `/projects/:id/agents`,
  `/agents`, `/projects`, plus the separate `/admin` console — no `#` fragments.
  Reload and Back/Forward preserve the project and workspace; legacy `#/…`
  bookmarks are rewritten on boot. The workbench deliberately stays one
  code-split SPA because the sheet, board, undo history and agent sessions are
  shared live state; see
  [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md#url-scheme-and-why-the-workbench-stays-one-spa).
- **Command palette** (**Ctrl/⌘+K**): search and run any workspace mode, demo or
  document action with the keyboard, including the capabilities and limits
  register.
- **Hover help and the help centre** (**F1** or **?**, or the header help button):
  resting on a rail button, header control or workspace tab raises a delayed
  one-line description with its keycap, and the same registry fills the help
  centre — a guide to all 25 workspaces, the control reference and a shortcut
  table. Guides name the method and the limits; they do not promise validity.
- **Hands-on tutorials**: seven walkthroughs — rectifier to fabrication, control
  and the ML toolbox, RF filters, two-link robotics, the mechanical enclosure,
  HDL/FPGA/IC and the agent verifier — each load a real demo board and name the
  actual panel buttons plus what to look for. Steps are self-checked and say so;
  progress is stored locally and resumable. Demos that a tutorial is built on
  carry a **Guided** chip in the gallery.
- **Guided tour** (first run, replayable from Settings): thirteen steps with an
  animated spotlight — pulsing halo, corner brackets and a caret that points at
  the control being described — that switches workspaces as it goes and persists
  or resumes progress. The steps that teach a gesture (wiring, chart zoom/pan,
  3D orbit) leave the app live so you can try them inside the tour; the rest are
  modal. Arrow keys, Esc, clickable step dots and a tab trap work; reduced-motion
  users get instant positioning and no halo. While no design is open the card
  offers to create one, and taking it carries the guide into the workspace the
  next steps point at. A coach mark never sits on the control it is describing:
  it docks in whichever corner leaves that control in the clear, folds the stage
  checklist away on a short window to buy that room, and gives up the spotlight
  rather than draw brackets underneath the card. Closing the guide early
  is recorded as an exit carrying the number of steps actually opened — only
  reaching the end is a finished tour. The last step hands off to the
  limits register rather than to a "you're done" screen.
- **Capabilities and limits register** (`LIMITS` in the status bar): one machine
  readable list — `src/lib/workspace/limitsRegistry.ts`, rendered by the dialog
  so the two cannot drift — stating for each family of results what is computed,
  the method actually in the source, the test files that pin it, and what the
  model refuses to cover. Tests enforce that every cited file exists, that every
  workspace mode is named, and that no positive claim uses the words
  "guarantee", "certified", "zero errors" or "always correct".
- A contextual status bar reports the active mode, schematic metrics, theme and
  unsaved state.

### Schematic & circuit simulation

- Drag/drop or click-to-arm placement, searchable 69-part library, grid snap,
  click-to-click wiring with junctions, properties inspector, undo/redo, rulers.
- MNA SPICE-style solver written in TypeScript: DC operating point, DC sweep,
  transient, AC, noise, and Monte Carlo, with 51 validated semiconductor models
  and behavioral sources.
- Discrete-event digital simulator (four-state logic, gates, flip-flops, clocks,
  X propagation, combinational-loop detection) and a lockstep mixed-signal bridge
  to the analog solver.
- Netlist import/export, waveform viewer with measurements, per-net PCB feedback.
- Every solved DC/transient/sweep run reports declared-rating margins, a
  first-order junction-temperature estimate, the supplied/dissipated power
  budget, and an explicit list of parts that could not be rated. All of it is
  measured from the solved circuit against declared limits or a vendor model —
  never assumed, and thermal numbers are labelled as estimates.
- Multi-sheet schematics and KiCad netlist round-tripping.

### PCB & manufacturing

- Schematic-to-PCB conversion, auto-routing, multi-layer canvas with an editable
  board outline, DRC and ERC.
- The 3-D/AR viewer renders the routed layout itself: the actual outline,
  per-layer copper traces, via barrels, footprint pads and component bodies
  sized from the footprint library. The same geometry feeds STL/OBJ export, so
  the exported model matches the board on screen; the PCB panel links straight
  to it with **Preview 3D**. Off-board traces, vias and parts are reported, not
  clamped to the edge.
- Steady-state thermal analysis on a 2-D finite-volume grid with convection on
  both faces. The solver is shared across three execution paths:
  **WebGPU** (WGSL Jacobi), **Worker**, and **main thread** (SOR). GPU results
  are only accepted after the residual converges; otherwise dispatch falls back.
- Signal integrity: single-line microstrip/stripline impedance, reflection
  lattice, a bisection-based trace-width optimiser, and a pattern-driven eye
  diagram (ISI, rise time, reflection overshoot). The panel analyses a routed
  trace with declared stackup and driver assumptions; crosstalk is not modelled.
- Closed-form EMC emission estimates, stackup/impedance rules, differential
  pairs, BGA fanout, power integrity, DDR constraints, HDI routing.
- Fabrication output: Gerber set, Excellon drill, centroid/PnP, BOM, and an
  optional encrypted project export (AES-GCM-256 with PBKDF2 key derivation).

### Control systems & electric machines

- Transfer-function algebra (series, parallel, feedback), complex polynomial
  roots by Durand–Kerner, pole/zero stability classification, controllable-
  canonical state-space conversion, RK4 time simulation, step/impulse metrics,
  log-spaced Bode magnitude and unwrapped phase, gain/phase margins, Nyquist,
  and controllability/observability ranks. The **Control** workspace panel
  drives a plant plus optional PID controller and plots the closed-loop step and
  Bode response.
- PID: continuous filtered-derivative transfer function, unit-feedback closed
  loop, and a sampled controller with derivative-on-measurement, first-order
  derivative filtering, output clamping and conditional-integration anti-windup.
- Brushed DC motor/generator: two-state armature model stepped exactly with a
  zero-order-hold matrix exponential (**independent of the output sample
  interval**), load/generator torque sign conventions, terminal-voltage and
  efficiency reporting. BLDC/PMSM: dq model with ideal FOC decoupling. Stepper:
  sinusoidal holding torque, first-order phase-current lag, detent and lumped
  damping, with RK4 substepping sized from the electrical/mechanical time
  constants. The **Machines** workspace panel shows steady-state operating
  points and time-domain speed, current, torque, power, dq and rotor-position
  traces.

### RF, HDL/FPGA, and IC design

- Microstrip/stripline/antenna calculations and RF filter synthesis, exposed in a
  dedicated RF workspace panel. Dipole/monopole directivity is numerically
  integrated from the far-field pattern (gain equals directivity because no
  ohmic-loss model is bundled); the antenna optimiser searches length and
  refuses targets outside the achievable range instead of returning a best-effort
  miss.
- VHDL/Verilog subsets with parsers, logic synthesis, FPGA flow helpers, and
  testbench-ready netlists.
- IC design flow adapters, SKY130 standard-cell library, silicon floorplanning
  with die/core sizing and macro placement, GDSII export, and package/chip
  models (QFN/TQFP/BGA with bond-wire parasitics).
- Four-state digital simulation for gates and flip-flops, plus a **Device Lab**
  for catalog logic/memory chips: 74HC595 shift/latch edges, 74HC165 parallel
  load and serial shift, 74HC138 active-low decoding, 23LC1024 SRAM, 24LC256
  paged EEPROM (5 ms write cycle, page-boundary checks) and W25Q128 NOR flash
  (clear-bits-until-erase semantics, 4 KB sector erase timing).

### Mechanical & 3D

- Shared material catalogue (density, modulus, yield, conductivity) used by every
  mechanical analysis.
- Euler–Bernoulli beam analysis with deflection, stress, natural frequencies, and
  buckling load. The solver honours the part's support condition (fixed →
  cantilever, pinned/roller → simply supported) and keeps axial force out of the
  transverse deflection; modal and buckling results name the part they belong to.
  Unsupported parts are reported instead of being analysed as cantilevers.
  Structural and thermal panel integration. This is a reduced-order beam model,
  not a 3D finite-element solve; plates are analysed as beams.
- STEP assembly, STL, and real FDM slicing to G-code: triangle–plane slicing,
  contour chaining, hole/outer orientation, clipped rectilinear infill, solid
  top/bottom shells, brim/raft/skirt, and volumetric extrusion in relative mode.
  The mechanical STEP export is AP214 with one faceted closed shell per
  component, emitted through the same writer as the enclosure and mechanism
  exporters. The mechanical panel slices the generated enclosure tray end to end.
  Honest limits: one perimeter path (no multi-wall offsetting), no support
  generation, FDM only — SLA/SLS and support requests are refused rather than
  emitting invalid G-code, and open mesh chains are reported, not fabricated.
- Printability metrics (overhang, thin walls, build-volume fit) computed from the
  actual mesh.
- Particle-swarm section sizing (PSO over width/height with stress, deflection,
  and slenderness constraints), applied back to the beam model. The result is
  re-checked against the closed-form relations before it is shown as feasible.
- Three.js viewer, XR preview, enclosure workflow from PCB dimensions. The PCB
  mode's 3-D preview is driven by the routed board (outline, copper, vias,
  footprints) rather than a fixed demo slab.

### Robotics, embedded & IIoT

- Forward/inverse kinematics with a damped least-squares IK solver (6-row
  geometric Jacobian, adaptive damping, step limiting, joint-limit clamping).
  IK starts from the current pose and, when that fails, retries a deterministic
  distance-ordered set of joint-space seeds, so reachable targets are not missed
  because of a poor initial guess; no randomness is involved. Trajectory
  helpers, joint preview, and advanced robotics panels.
- Numerical rigid-body dynamics for serial revolute/prismatic chains: Jacobian
  mass matrix, gravity vector, Coriolis/centrifugal (Ṁq̇ − ½∇(q̇ᵀMq̇)), energy,
  and mass-matrix conditioning. Unsupported joint types and malformed state
  vectors are rejected with an explicit error instead of a fabricated result;
  friction, motor dynamics, and flexible-body effects are not modelled.
- Mechanism replay samples the planned joint-space profile from the planned
  start pose, or integrates declared joint velocities from the current pose;
  with no planned move the current pose is held. Joint values at the service
  boundary are degrees for revolute joints and metres for prismatic joints, and
  unsupported joint types are rejected. Task simulation rejects non-monotonic
  timestamps, out-of-limit or non-finite waypoints, and empty tasks; collision
  tests the tool point against each obstacle's declared box/sphere/cylinder
  (links are not swept), and smoothness is a sample-density-independent
  dimensionless-jerk score that reports no value at all below four samples —
  a recording too short to estimate jerk is not a clean one. Box-level link collision is the only contact model,
  so narrow-phase contact is not reported rather than invented.
- Arduino-style firmware flow, board programming over WebSerial (live with a
  granted port; fails loudly otherwise), Intel HEX round-trip, HIL scenarios,
  digital-twin demo, and hardware interface simulators (I²C/SPI/UART/CAN).
  Hardware bridges speak newline-delimited JSON with request ids and per-request
  timeouts; wrong-length or non-byte replies are rejected, never zero-filled.

### Agents, collaboration, plugins & security

- Agent harness with EDA tools and a symbolic verifier; AI chat, datasheet
  importer, and marketplace panels.
- Agents operate the CAD like a human: observe the canonical sheet and an SVG,
  add/move/remove parts, wire pins and T-tap named rails, simulate, read
  ratings/thermal margins, run ERC, export SPICE, and undo. After routing,
  `eda.observe` returns the board as canonical JSON (`folio.pcb/1`: outline,
  resolved layer stack, parts/pads, copper and warnings) plus an SVG top view
  built from the same scene the PCB editor and 3-D preview draw. Off-board and
  unknown-footprint geometry is reported, never silently clamped. `eda.movePart`
  moves or rotates one placed part and re-routes in the same call, so copper can
  never silently lag the pads; `eda.addTrace` and `eda.addVia` add agent-authored
  copper with on-board validation. DRC remains the gate before fabrication, and
  removing copper is still human-only. Route, DRC, and fab export all consume
  that published layout. The agent workbench shows the routed-board view beside
  the schematic and waveform previews. The same tools drive a deterministic
  bounded autopilot that scores each iteration, restores the best design, and
  reports that a bounded search is not a global optimum. The Assistant harness
  registers those `cad.*` tools against the live store too, so an inspection
  call returns the same schematic SVG the canvas shows — drawn with explicit
  ink and upright labels — straight into the transcript.
- Mechanical design is store-backed as well: `mech.observe` returns the assembly
  as canonical JSON (`folio.mechanical/1`: parts, materials, supports, loads,
  mass properties, closed-form stress/deflection/safety factor/modes/buckling,
  and warnings) plus a millimetre front-elevation SVG. `mech.addPart`,
  `mech.movePart`, `mech.resizePart`, `mech.setSupport`, and `mech.setLoad`
  publish to the same store the mechanical workspace and its 3-D viewport render,
  and `mech.analyze` re-runs the closed forms after every edit. `mech.autopilot`
  sizes one part through a bounded dimension/material grid under safety-factor,
  deflection, stress, natural-frequency, buckling, and mass limits; it writes
  every candidate to the live assembly, returns a drawing per iteration, and
  restores the best measured section while saying the result is not a global
  optimum. An unsupported part is reported as a warning so the agent can fix it
  rather than losing the rest of the assembly; removing parts remains human-only.
  The autopilot tab switches between circuit tuning and mechanical sizing, and
  shows the assembly drawing beside the schematic, waveforms, and routed board.
- Durable agent-session timeline in local storage (bounded history, quota-aware
  writes). Always-on/background agents need a server-side runner; the exact job
  protocol, security requirements, and worker checklist are in
  [docs/AGENT_CLOUD.md](docs/AGENT_CLOUD.md). Without `VITE_AGENT_CLOUD_URL`
  the UI says so and local autopilot still works.
- Local project store, autosave, content-addressed version history and backup
  snapshots. A commit captures the whole multi-domain design — schematic, routed
  PCB, mechanical assembly, firmware and every registered CAD domain — with diff,
  branch, tag, three-way merge and restore. Where the Git remote, browser VCS,
  optional Supabase data and a costed hosting topology live is documented in
  [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).
- Sharing/roles (owner, admin, editor, reviewer, viewer) with permission checks.
  These are collaboration roles; the governance roles used by `/admin` are
  owner, administrator, engineer and viewer, documented in
  [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md).
  Real-time presence and operation broadcast use Supabase Realtime **when
  configured**; otherwise the sharing model is local-only, and the status row
  says so. Presence and broadcast are separate channel calls: if the track
  fails, the panel reports that peers may not see you rather than claiming a
  healthy realtime session.
- Plugin system with manifest validation, declared-permission gating, lifecycle
  hooks, marketplace install/uninstall. Plugin code runs in the page; permissions
  gate host API actions, not a security sandbox.
- Asset RBAC and encrypted exports. The in-session audit trail records grants,
  encryptions, decryptions, and refusals.

### Administration

- **Administration console** at `/admin` (header shield, or the More menu on
  narrow screens). It is a sibling surface to the CAD workspaces and opens with
  or without a project loaded.
- **Local mode**: the device owner is the administrator. The console reports
  people, the device's usage ledger, quota policies, the SIEM audit trail, and
  the real environment (storage estimate, agent-runner capability).
- **Cloud mode**: apply
  `supabase/migrations/20261026120000_admin_governance.sql` for `profiles`,
  `usage_events` and `quota_policies`, with RLS, a self-demotion guard and
  Postgres quota triggers. New sign-ups become viewers; an owner promotes them
  from the People tab.
- **Measured usage**: workspace opens, demos, projects, version commits, exports,
  solver runs, agent runs, onboarding and admin opens. The ledger is append-only,
  capped at 5,000 events per browser, and never leaves the device unless a cloud
  deployment is configured. The Usage tab has day windows, filters, CSV export
  and a daily chart.
- **Enforced quotas**: project creation, exports and solver runs are checked in
  the browser against the role policy, and cloud activity is enforced again by
  the database triggers. Owner and administrator limits are fixed at unlimited;
  storage is reported as advisory because the browser owns the quota.
- Invitations are **not** faked: they require a service-role server function.
  The console labels that capability honestly. Full contract and bootstrap SQL:
  [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md).

### Compute acceleration

The PCB panel's **Compute Acceleration** card probes the actual browser:

- WebGPU availability and adapter name
- Worker support and SharedArrayBuffer availability
- Recommended thermal path

WebGPU is used only for grids of at least 1,024 cells; smaller grids stay on the
CPU to avoid upload overhead. If the adapter, pipeline, or readback fails, the
dispatch falls back to Worker → CPU. The reported accelerator is the path that
produced the converged result.

---

## Verification

```bash
npm run lint            # ESLint, zero warnings
npm run a11y:buttons    # every icon-only button has an accessible name
npm run typecheck       # app TypeScript
npm run typecheck:node  # Vite/build config TypeScript
npm test                # Vitest, 2,166 tests / 216 files
npm run build           # production build
npm run verify          # all of the gates above, in order
npm run preview         # preview the build on port 4173
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR.

The acceleration paths have been checked in a real browser (Chrome/Electron
WebGPU): the GPU thermal grid matches the CPU reference peak and average within
0.01 °C and is only labelled `webgpu` when converged.

All 31 gallery scenarios were also opened in the in-app Chromium session against
the dev server (2026-10-26): every workspace rendered without a console error or
uncaught exception, and the 3D demo exposed its routed scene and STL/OBJ export.

---

## Project layout

```
src/
  components/        React panels (schematic, pcb, mechanical, robotics, rf, ecad…)
  lib/
    simulation/      SPICE, digital, mixed-signal, devices, netlists
    pcb/             thermal, PCB scene geometry and layout engines
    manufacturing/   DRC/ERC, fab export, SI, stackup, autorouting
    acceleration/    WebGPU/Worker thermal dispatch and capability probing
    mechanical/      materials, beam/FEA, assemblies, kinematics, dynamics
    rf/              antenna and RF circuit design
    control/         transfer functions, PID, Bode/margins, state space
    electronics/     part catalogs, machine dynamics, logic/memory behaviour
    ic/ fpga/        IC flow, standard cells, GDS, HDL/synthesis
    security/        asset RBAC + AES-GCM encryption
    admin/           usage ledger, quota policy, governance data access
    collaboration/   local sharing model + optional Supabase Realtime
    plugins/         plugin system and permission checks
  stores/            Zustand state and undo
  __tests__/         render/integration tests
```

---

## Honest limits

The same statements live inside the product: `src/lib/workspace/limitsRegistry.ts`
records what each analysis computes, the method behind it, the test file that
pins it and what it refuses to model, and the `LIMITS` dialog renders that file.
Tests fail if a cited test file disappears, if a workspace mode is left
unspeaking, or if a positive claim uses hedging-free wording such as "guaranteed"
or "zero errors". The bullets below are the prose form of that register.

- Simulations are engineering approximations for design exploration, not
  certified sign-off. Validate thermal, SI, EMC, and structural results against
  measured hardware before fabrication.
- The circuit solver uses dense LU on the full MNA matrix. It targets
  board-scale circuits (hundreds of nodes), not million-node IC netlists; there
  is no sparse/iterative solver and no foundry-validated device-model
  certification.
- Transient analysis offers backward Euler (the default: first-order, monotone,
  unconditionally stable), trapezoidal integration (second-order, preserves LC
  ringing), and Gear/BDF2 (second-order, A-stable, damps high-frequency numerical
  ringing), with backward-Euler startup/restart and adaptive subdivision. Gear is
  fixed at order 2; there is no variable-order BDF.
- AC and noise analyses linearise about a converged DC operating point whenever
  a device is bias-dependent. A purely linear circuit with an indeterminate DC
  bias is solved at zero bias and reports that explicitly; a singular AC network
  still fails rather than returning a curve.
- SI is a closed-form single-line lattice with an eye diagram built from that
  lattice (no crosstalk, IBIS transient, or full-wave field solve). EMC is a
  closed-form loop/dipole estimate at 3 m, not a chamber measurement.
- Thermal and structural analyses are reduced-order: a 2-D finite-volume PCB
  grid, 1-D/2-D members and trusses, and closed-form beam/shaft/column formulas.
  They are not 3-D FEA, CFD, or contact solvers.
- Control analysis is single-input/single-output and linear time-invariant.
  Polynomial roots, Bode curves and margins are computed from the declared
  transfer function; nonlinear plants, MIMO state feedback, observers and
  hardware-in-the-loop controller tuning are not included. The PID loop is
  simulated, and it can also be auto-tuned: rules of thumb on an identified
  first-order-plus-dead-time model, relay auto-tuning, bounded search over the
  closed-loop simulation and Gaussian-process surrogate search, each reporting
  its cost breakdown, margins, termination reason and evaluation budget. The
  linear routes judge the continuous-time loop — actuator saturation and
  anti-windup are nonlinear and are checked separately with the sampled loop.
- Electric machines use lumped-parameter models (armature R/L, torque and back-EMF
  constants, inertia, viscous damping). Magnetic saturation, cogging, eddy/
  hysteresis losses, thermal derating and finite-element field solutions are not
  modelled; stepper damping is a single lumped coefficient standing in for
  bearing friction and back-EMF/eddy effects.
- The PCB 3-D viewer is a geometry preview and mesh exporter (STL/OBJ), not an
  electromagnetic, thermal or mechanical co-solve.
- The IC flow targets a digital RTL subset with the bundled SKY130 cell set. Its
  GDSII is a flow artifact for inspection and education — it is not DRC/LVS-clean
  foundry tapeout, and there is no analog, custom or transistor-level layout
  editor. Device Lab models datasheet-level logic and memory-array behaviour
  (page/erase rules and timing constants), not full SPI/I²C bus timing or
  analog electrical models.
- Supabase and AI provider integrations are optional. Without credentials, cloud
  sync and live AI answers are unavailable by design.
- Real-time collaboration needs Supabase Realtime; the role/share UI works
  locally without it.
- The installable plugin surface is permission-gated but not sandboxed.
- The agent tool surface covers the schematic, the routed board and the
  mechanical assembly: observe, edit, wire, simulate, assess, verify, route and
  export for each, plus fabrication checks on the PCB. Its live feedback is the
  canonical snapshot (schematic SVG, board layout, assembly view) and waveforms.
  Robotics, RF, HDL/IC, digital-twin and plugin authoring are not agent-driven
  yet; the Tools tab in the assistant lists exactly which calls exist rather than
  describing a wider surface than the harness registers.
- The language selector stores a preference; only English strings ship.
- No GDPR, ISO 27001, or IEC 62443 certification is claimed.

---

## License

MIT — see [LICENSE](LICENSE).
