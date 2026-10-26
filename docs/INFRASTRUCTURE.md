# Infrastructure, source control, storage and hosting

This document records where Folio's code and design data actually live, what the
optional cloud pieces are for, and which parts are still a deployment task. It
is deliberately factual: anything marked **cloud deployment task** is not shipped
in this repository.

Verified against the working tree on 2026-10-26.

## 1. Source control (the code)

| Item | Location |
| --- | --- |
| Working copy | `C:\Users\digit\Downloads\folio` |
| Git database | `C:\Users\digit\Downloads\folio\.git` |
| Remote | `https://github.com/Ancillary-AGI/folio.git` (`origin`) |
| Default branch | `main` |
| CI | `.github/` workflows in the repository |

Operational checks:

```bash
git status
git log --oneline -10
git branch -vv
```

`origin/main` tracks the published branch. Local commits remain local until
someone explicitly pushes; nothing in the app pushes automatically. Pushing is
a deliberate, reviewed action.

### Design version control inside the app

The product also versions *designs*, separately from the source tree:

- `src/lib/vcs/vcsService.ts` implements a content-addressed, Git-like history
  (SHA-256 commit ids, parents, tree hash, branches, tags) per project.
  A snapshot is the **whole multidomain project**: schematic components and
  wires, firmware, viewport, the routed PCB layout when one exists, the
  mechanical assembly, and a `domains` bag holding the design state of every
  other CAD workspace (RF antennas/filters, control plants and PID gains,
  electric machines, HDL, FPGA, IC/device-lab settings, robotics mechanisms and
  pose, and visual-programming graphs). Domain panels publish their serialisable
  inputs through `src/lib/project/domainDesign.ts`, so a commit can never
  describe only half of a cross-domain design.
- Repositories persist to browser `localStorage` under `folio.vcs.v1`. The first
  commit of a chain is stored in full; later commits are stored as JSON patches
  against their first parent (falling back to a full copy when a patch would be
  larger), so long histories stay well inside the storage quota. Every snapshot
  is re-hashed on load; a failed check or unreadable payload is reported, and an
  unparseable store is copied to `folio.vcs.v1.corrupt.<timestamp>` before a
  clean store is started.
- Restoring a commit is non-destructive: it returns the old snapshot without
  moving the branch head, so the next commit records the restore on top of the
  newest work and nothing becomes unreachable. The restore replaces the working
  components, wires, code, viewport, routed board, mechanical parts and domain
  designs (when the commit recorded them), autosaves that canvas to the project,
  and every export then reads the restored design rather than the pre-restore
  one. Older commits that predate multidomain snapshots keep the live mechanical
  and domain state instead of silently replacing it with defaults.
- Branch merges run a three-way merge over the same full snapshot: id-keyed
  arrays (components, wires, mechanical parts) merge per item, records merge
  key-by-key, and domains merge independently. A field changed differently on
  both branches resolves to the checked-out branch, matching this service's
  deterministic, non-interactive merge policy.
- Other open tabs are kept in sync through the `storage` event; a tab reloads
  history written elsewhere instead of overwriting it with stale memory.
- `src/lib/backup/backupService.ts` keeps up to 50 JSON snapshots per project
  under `folio.backups` and is used before a VCS restore changes the editor.
  A backup captures the same working state as a commit, including the routed
  board. Deleting a project removes its local commits and checkpoints with it.
- Projects themselves persist to `folio.offlineProjects` when Supabase is not
  configured.

Consequence: this in-app history is **per browser profile**, not shared and not
server-backed. It survives reloads and offline use, but clearing site data
deletes it. If the browser quota is exhausted, commits and backups remain usable
for the current session and the version panel reports that they are session-only
rather than claiming they were saved. Durable, multi-device history is part of
the cloud deployment below.

## 2. What cloud storage is for

Supabase is optional. With no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`,
every feature that needs persistence falls back to local storage and the app
remains fully usable offline.

When configured, `supabase/` supplies the schema and the app uses it for:

| Table (migration `20251018170350_create_circuit_cad_schema.sql`) | Purpose |
| --- | --- |
| `projects` | Project metadata and thumbnails, owned by `auth.users` |
| `components` | Standard and user-authored part symbols |
| `schematics` | Canvas JSON per sheet, ordered within a project |
| `placed_components` | Placement, rotation, reference and properties |
| `wires` | Polyline points, connected pins and net names |

Row-level security scopes rows to the authenticated owner. The migration also
creates indexes for project lists and per-sheet loads.

A second optional migration, `20261026120000_admin_governance.sql`, adds the
administration directory and its enforcement:

| Table | Purpose |
| --- | --- |
| `profiles` | Role (owner/admin/engineer/viewer), status and last-seen per auth account |
| `usage_events` | Append-only ledger written by the client recorder and quota triggers |
| `quota_policies` | Per-role project, export, simulation and storage limits (`NULL` = unlimited) |

It also installs the admin-only RLS policies, a new-user profile trigger, a
self-demotion guard, and `BEFORE INSERT` quota triggers for projects and daily
export/simulation usage. Local mode does not need this schema. Apply it and
promote the first owner as described in [ADMINISTRATION.md](ADMINISTRATION.md);
invitations still require a service-role server function and are intentionally
absent from the browser.

Cloud storage is therefore for: account-backed projects, shared/multi-device
design data, the standard part library, governance/usage records, and (once the
runner exists) durable agent job/audit records. It is **not** a build artifact
store and the repository does not currently upload Gerber/STL/SVG outputs
anywhere; those are downloaded by the browser.

Optional real-time collaboration uses Supabase Realtime presence/broadcast when
configured. The sharing/role UI works locally, but live presence is cloud-only.

### Agent runner

Always-on agents need a server-side worker. The browser contract, job payload
and capability split are defined in [AGENT_CLOUD.md](AGENT_CLOUD.md). The runner
process itself, a queue, sandbox isolation, quotas and cancellation are **cloud
deployment tasks**; the local autopilot (tab open) is the shipped behaviour.

## 3. Hosting topology that fits this app

Folio builds to a static SPA (`npm run build` → `dist/`). It does not need a
Node server to serve the UI. The economical topology is therefore:

1. **Static front end** — Cloudflare Pages, Netlify or Vercel (free tiers are
   adequate during development). Requirements: SPA fallback to `index.html`,
   HTTPS, and long-lived caching for hashed assets. The fallback is checked in:
   `public/_redirects` (Netlify / Cloudflare Pages) and `vercel.json` (Vercel).
   Estimated cost: **$0** at low traffic.
2. **Managed Postgres + auth + object storage** — Supabase (free tier for
   development; paid plan roughly $25/month once a project needs daily backups
   and higher limits). This replaces the local-storage fallback with accounts,
   RLS and multi-device persistence.
3. **Agent runner (only if always-on agents are offered)** — a small
   container service that scales to zero (Cloud Run, Fly.io Machines, Railway),
   pulling jobs from a Postgres queue or Supabase table. Expect roughly
   **$5–40/month** at low volume, dominated by memory/CPU seconds when jobs run.
   Each job must be sandboxed and capped; designs are CPU-bound simulation and
   routing work, not GPU work.
4. **Object storage for winners and audit logs** — Supabase Storage or
   Cloudflare R2 (R2 has no egress fee), only when the runner is deployed.

A realistic starting bill is **$0–30/month** for the SPA plus database, rising
to roughly **$50–150/month** with an always-on runner and moderate job volume.
Provider prices change; treat these as order-of-magnitude planning figures, not
quotes.

### URL scheme and why the workbench stays one SPA

Every workspace is a route inside one SPA because the schematic, routed board,
undo history, agent sessions and WebGL contexts are live shared state. A
multi-page app would reload that state on every handoff (route → 3D → agent);
several SPAs would duplicate the framework and vendor chunks. Workspaces are
already split with `React.lazy`, so first paint carries the shell and the active
panel only.

| Path | Screen |
| --- | --- |
| `/` | project landing, or the open project's schematic |
| `/projects` | project list |
| `/projects/:projectId` | that project's schematic |
| `/projects/:projectId/<workspace>` | e.g. `/projects/abc/pcb`, `/projects/abc/agents` |
| `/<workspace>` | workspace before a project is chosen (e.g. `/agents`) |

Paths use the History API, so there is no `#` in the address bar; reload and
Back/Forward preserve the workspace and project. Old `#/pcb?project=abc`
bookmarks are rewritten once on boot. Offline deep links reopen the local
project directly; cloud projects wait for sign-in. Unknown paths normalise to
`/projects`. The server contract is one line: unknown paths return
`index.html`, while hashed files under `/assets/` are served (and cached)
directly.

### Why not a cloud desktop / VPS per user?

The CAD environment is a browser SPA and all interactive solvers run in the tab.
A per-user virtual desktop would add cost and latency without improving the
human workflow. The genuinely server-side piece is the headless runner for
subscription (always-on) agents, which needs a job queue and sandbox — not a
remote desktop.

## 4. Deployment checklist (not yet executed)

- [ ] Create the Supabase project, set `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY`, run `npm run db:push` (or `db:reset` locally).
- [ ] Promote the first governance owner
      (`update public.profiles set role = 'owner' where email = '…';`) and open
      `/admin`; see [ADMINISTRATION.md](ADMINISTRATION.md).
- [ ] Build (`npm run build`) and upload `dist/` to the static host with SPA
      fallback.
- [ ] Add the deployment origin to Supabase auth redirect URLs.
- [ ] Deploy the agent runner and set `VITE_AGENT_CLOUD_URL`; mint short-lived
      scoped tokens server-side. Never put a service key in a `VITE_*` variable.
- [ ] Configure backups and retention for Postgres and design artifacts.
- [ ] Keep `npm run verify` green before publishing a build.

## 5. Local-only guarantees

Without any environment variables, the following work with no network:

- Schematic capture, PCB layout/routing, DRC/EMC/thermal/SI checks, Gerber and
  fabrication package export.
- SPICE simulation (DC, sweep, transient, AC, noise, Monte Carlo, mixed-signal).
- Mechanical CAD, third-angle part drawings, STEP/STL/OBJ/GLTF export.
- In-app VCS, backups, imports/exports and the demo gallery.
- The local autopilot loop, while the tab remains open.

The status bar shows **LOCAL ONLY** in this mode. Cloud-labelled actions either
become available when configured or report that the deployment is missing; they
do not silently pretend to succeed.
