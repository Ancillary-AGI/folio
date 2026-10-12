# Folio - Feature Documentation

> **Honesty note:** every feature below exists in the codebase today. Markers:
> ✅ = implemented and covered by automated tests · 🟡 = implemented at UI level
> without a dedicated test. Earlier drafts of this file claimed features that do
> not exist; those are listed explicitly under "Not implemented" so they do not
> creep back. Counts come from `npm test`, which CI runs on every push.

## 🎯 Schematic Editor ✅

- **Drag-and-drop placement**: click-to-arm in the parts browser, or drag onto the sheet
- **Parts browser**: grouped, searchable list with symbol glyph badges, pin counts, and live shown/total counts
- **Wiring**: click-to-click wire drawing with connection detection, junctions, and net labels on an infinite zoom/pan canvas
- **Grid & snap**: configurable grid with snap-to-grid placement
- **Properties inspector**: reference designator, type/category, electrical property rows, position/rotation transforms, read-only pin table, explicit Apply/Reset
- **Design history**: simulation runs and edits persist into the saved design

## ⚡ Simulation Engine ✅

- **Analysis types**: DC operating point, DC sweep, transient, AC, noise, and Monte Carlo (six analyses wired into the simulation panel)
- **In-app SPICE-style solver**: MNA stamping with 51 validated semiconductor devices (µ-normalized part library) and behavioral sources
- **Digital logic simulator — runnable in the app**: discrete-event, four-state (0/1/X/Z) engine — combinational gates (NOT/BUF/AND/NAND/OR/NOR/XOR/XNOR) with propagation delay, edge-triggered flip-flops (SR/D/JK/T), clocks and stimuli, priority-ordered event heap, X-propagating and fail-loud on combinational loops (`digitalLogic.ts`). Reachable from the **Simulation panel → "Digital timing"** analysis: paste a compact digital deck (`digitalNetlistParser.ts`, fail-loud per line number), run, and read a step timing diagram plus final node values. A ready-to-run 2-bit ripple-counter deck is preloaded.
- **Mixed-signal co-simulation** (`mixedSignal.ts`): lockstep bridge couples the digital engine to the analog SPICE solver — digital nets drive the analog net as PWL voltage sources, analog probes threshold back into digital stimuli, iterated over macro-steps, so a GPIO driving a load or a comparator driving logic works in one run.
- **Solver truth**: every analog and digital result checked against independently-computed reference equations at test time (no hand-typed tables) — fail-loud contract: unsupported constructs error, never invent a curve
- **SPICE netlist import/export**: `netlistBuilder` + `spiceEngine` deck export with correct device card forms
- **Waveform viewer**: interactive line charts with tooltips, legends, and measurement readouts (recharts)
- **Multiphysics**: coupled thermal/structural solvers with golden-vector regression tests
- **Per-net design-rule feedback** in the PCB flow

## 🖥 PCB Design ✅

- **Schematic → PCB conversion**: placement and auto-routing with design-rule constraints (converter is unit-tested)
- **Multi-sheet schematics**: global-label stitching across sheets with private locals and duplicate-reference rejection (`multiSheet.ts`)
- **KiCad netlist interchange**: s-expression import/export with round-trip tests (`kicadNetlist.ts`)
- **PCB canvas**: board outline, traces, vias, pads, layer visibility toggles with color-coded layer list
- **DRC**: clearance, trace width, drill, and annular-ring checks (`src/lib/manufacturing/drc.ts`)
- **Manufacturing output**: full fab package — Gerber layer set (F/B Cu, masks, silks, Edge.Cuts), true Excellon drill, centroid/PnP, MPN BOM — gated on JLCPCB DRC (`fabExport.ts`, parser-validated tests); multilayer stackup + impedance engine, differential pairs, BGA fanout, power integrity, DDR rules, enclosure STEP
- **Bill of Materials**: cost, quantity, lifecycle and availability badges, editable per-line notes

## 🤖 Robotics, Mechanical & 3D ✅ / 🟡

- **3D circuit viewer**: three.js scene with grid/PCB/components/traces visibility toggles, STL/OBJ export (render-tested)
- **Mechanical/FEA panel**: multiphysics thermal-structural analysis controls (render-tested)
- **Robotics toolbox & kinematics**: 3D robot preview, joint framing, advanced kinematics helpers (`advancedRobotics.ts`)

## 🔌 Embedded & Hardware ✅ / 🟡

- **Hardware interfaces**: simulated I²C, SPI, UART, and CAN with a manager API (fully unit-tested)
- **Firmware artifacts**: Intel HEX parse/serialize with round-trip tests
- **Board programming**: STK500v1 upload over WebSerial with read-back verification (live when a port is granted, honest refusal otherwise); browser-side toolchain integration fails closed outside Node (guarded, tested); bulk SD-image flasher core with MBR parse and hash-verified chunks
- **Hardware-in-the-loop panel**: HIL scenario UI (render-tested)

## 🧠 AI Design Assistant ✅

- **aiService**: component recommendations, circuit analysis, and natural-language-to-design suggestions (unit-tested; requires a configured provider to answer live)
- **AI chat panel**: conversational UI with quick actions, confidence metadata, and response feedback (render-tested)

## 🗂 Projects, Versioning & Offline ✅

- **Offline-first projects**: local project store with create/open/save/delete (unit-tested) — the app boots fully offline into the IDE (smoke-tested)
- **Cloud (optional)**: Supabase auth and project persistence when configured; local-only mode never contacts it
- **Version history**: local commit-style history with restore (vcsService tests) plus snapshot checkpoints (backupService tests)
- **Auto-save**: configurable interval, dirty-state indicator, canvas persistence

## ⚙️ Settings, Theming & Accessibility ✅

- **Themes**: light, dark, and high-contrast (WCAG 2.2 AAA) with system-preference following; retired theme names migrate cleanly (18 theme tests)
- **Units & behavior**: metric/imperial units, animations toggle, auto-save interval, onboarding replay
- **Language selector**: preference is stored, but only English strings ship today (no translations yet)
- **Guided onboarding**: first-run tour (smoke-tested)
- **Accessibility**: keyboard-operable toolbars and rails; every icon-only button must carry an accessible name — enforced by `npm run a11y:buttons` in CI

## 🛠 Quality Infrastructure ✅

- **CI (GitHub Actions)**: lint (zero warnings), button-label audit, typecheck (app + build config), full test suite, production build
- **Tests**: 451 tests across 45 files, including React render tests for the app shell and project manager
- **Bundle**: 805 KB critical path (242 KB gzip) with lazy-loaded heavy panels (3D, robotics, simulation)

## ❌ Not implemented (previous drafts claimed these)

- Real-time multi-user collaboration, comments/review workflows
- Cloud sync beyond optional Supabase project persistence
- Plugin system, JavaScript/Python scripting, REST API
- UI translations (language selector exists; strings do not)
- Font/icon-set options (context menus and the symbol editor are now implemented)
- GDPR/compliance certifications, end-to-end encryption claims
- Classroom management, automated grading

This document tracks what Folio actually is: a browser-based, offline-first
engineering workbench for circuits, PCB, mechanical, robotics, and embedded
work, with tested simulation and manufacturing toolchains.
