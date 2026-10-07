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
- **SPICE netlist import/export**: `netlistBuilder` + `spiceEngine` deck export with correct device card forms
- **Waveform viewer**: interactive line charts with tooltips, legends, and measurement readouts (recharts)
- **Multiphysics**: coupled thermal/structural solvers with golden-vector regression tests
- **Per-net design-rule feedback** in the PCB flow

## 🖥 PCB Design ✅

- **Schematic → PCB conversion**: placement and auto-routing with design-rule constraints (converter is unit-tested)
- **PCB canvas**: board outline, traces, vias, pads, layer visibility toggles with color-coded layer list
- **DRC**: clearance, trace width, drill, and annular-ring checks (`src/lib/manufacturing/drc.ts`)
- **Manufacturing output**: Gerber export with aperture definitions (incl. drill/flash data)
- **Bill of Materials**: cost, quantity, lifecycle and availability badges, editable per-line notes

## 🤖 Robotics, Mechanical & 3D ✅ / 🟡

- **3D circuit viewer**: three.js scene with grid/PCB/components/traces visibility toggles (✅ logic, 🟡 UI)
- **Mechanical/FEA panel**: multiphysics thermal-structural analysis controls (✅ solver, 🟡 panel)
- **Robotics toolbox & kinematics**: 3D robot preview, joint framing, advanced kinematics helpers (`advancedRobotics.ts`)

## 🔌 Embedded & Hardware ✅ / 🟡

- **Hardware interfaces**: simulated I²C, SPI, UART, and CAN with a manager API (fully unit-tested)
- **Firmware artifacts**: Intel HEX parse/serialize with round-trip tests
- **Board programming**: browser-side toolchain integration that fails closed outside Node (guarded, tested)
- **Hardware-in-the-loop panel**: HIL scenario UI (🟡)

## 🧠 AI Design Assistant ✅ service / 🟡 UX

- **aiService**: component recommendations, circuit analysis, and natural-language-to-design suggestions (unit-tested; requires a configured provider to answer live)
- **AI chat panel**: conversational UI with quick actions, confidence metadata, and response feedback

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
- **Tests**: 311 tests across 22 files, including React render tests for the app shell and project manager
- **Bundle**: 805 KB critical path (242 KB gzip) with lazy-loaded heavy panels (3D, robotics, simulation)

## ❌ Not implemented (previous drafts claimed these)

- Multi-sheet / hierarchical schematics
- EAGLE, KiCad, or Altium import/export
- Real-time multi-user collaboration, comments/review workflows
- Cloud sync beyond optional Supabase project persistence
- Plugin system, JavaScript/Python scripting, REST API
- UI translations (language selector exists; strings do not)
- Context menus, symbol editor, font/icon-set options
- GDPR/compliance certifications, end-to-end encryption claims
- Classroom management, automated grading

This document tracks what Folio actually is: a browser-based, offline-first
engineering workbench for circuits, PCB, mechanical, robotics, and embedded
work, with tested simulation and manufacturing toolchains.
