# Deployment and operations

How to run Folio on your own machine or a server: the local backend, hosting and
storage, and the always-on agent runner. One document for everything operational.

## Contents

- [The local Folio backend](#the-local-folio-backend)
- [Infrastructure, source control, storage and hosting](#infrastructure-source-control-storage-and-hosting)
- [Always-on agents: local loop, built-in runner, wire contract](#always-on-agents-local-loop-built-in-runner-wire-contract)
- [Authentication — how signing in works on this deployment](#authentication--how-signing-in-works-on-this-deployment)
- [Admin console and governance](#admin-console-and-governance)
- [Security policy](#security-policy)

---

## The local Folio backend

For development, self-hosting and honest offline work, Folio ships a real,
self-contained backend. It is not a simulation of one: it is a genuine
PostgreSQL (PGlite, PostgreSQL compiled to WASM, running in-process) with the
repo's real migrations and RLS policies applied, fronted by a tiny Node
service that speaks the same two API surfaces hosted Supabase does — so the
frontend needs no code changes, only build flags.

No Docker is required, no admin rights are required, no services need to be
installed. Everything runs from this repository.

### What runs where

```
┌────────────────────────────────────────────────────────┐
│ Folio frontend (NEXT_PUBLIC_SUPABASE_URL set)          │
└───────────────┬────────────────────────────────────────┘
                │ http://127.0.0.1:54321  (one origin, like hosted Supabase)
┌───────────────▼────────────────────────────────────────┐
│ server/index.ts (Node, one process)                     │
│  /auth/v1/*  — sign up, password grant, refresh, user, │
│                 sign out. scrypt hashes in auth.users, │
│                 HS256 JWTs shared with the REST layer  │
│  /rest/v1/*  — see server/rest/index.ts: a deliberately │
│                 translator for the tables and verbs the │
│                 app uses. Every statement runs as      │
│                 `authenticated` with the caller's JWT  │
│                 claims pinned, so RLS and the quota     │
│                 triggers decide every row — this file  │
│                 decides nothing.                       │
└───────────────┬────────────────────────────────────────┘
                │ in-process
┌───────────────▼────────────────────────────────────────┐
│ PGlite (real PostgreSQL 17, WASM) — server/db/index.ts  │
│  bootstrap-auth.sql creates the auth schema + roles;   │
│  supabase/migrations/*.sql then applied verbatim —     │
│  including enforce_project_quota() and                  │
│  enforce_usage_quota() triggers and all RLS policies    │
└────────────────────────────────────────────────────────┘
```

The frontend, the migrations and the RLS policies are byte-for-byte the same
as for hosted Supabase. There is no parallel implementation of the schema,
the triggers or the policies to drift.

Alternative mode: set `FOLIO_PG` to any reachable PostgreSQL connection
string and the same process uses it instead of the embedded database — the
migrations are applied there too, on boot, idempotently.

### Setup

```sh
npm run backend
```

First boot applies the auth bootstrap and every migration in
`supabase/migrations/` (takes a second or two), creates `.backend/pglite-data`,
and listens. Later boots re-apply the schema idempotently and start faster.

Then build the app against it (or run `npm run dev` with these set):

```sh
set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
set NEXT_PUBLIC_SUPABASE_ANON_KEY=folio-local-dev-anon-key
npm run build
```

The build is no longer standalone: it presents the hosted sign-in form, and
every project, quota, usage event and admin action goes to this database.

### Verifying it

With the backend running:

```sh
npm run backend:check
```

The check exercises the real HTTP surface — health, sign-up for two users,
RLS (user B cannot see user A's project), the viewer project quota firing at
the database level on the fourth insert, HEAD counting with `count=exact`,
the deployment-stats RPC refusing a non-operator, wrong-password refusal,
sign out, sign back in, and cleanup of the projects it created. It exits
non-zero on any failure. Measured 2026-11-17: **14 of 14 steps pass**.

Beyond the HTTP check, the full browser flow has been driven against it:
sign up → land in the workbench → create a project → reload → the project is
still there → `/console` shows the account as Cloud · Owner with the mirrored
usage ledger → `/admin` signs the operator in, reads deployment stats through
the `SECURITY DEFINER` function, and refuses a non-operator with a written
reason. The component library seeds once from the `seed_standard_library`
migration (118 parts) instead of a client-side insert that RLS correctly
refused.

One environment defect had to be fixed for this to work at all: the machine
could not run PostgREST's Windows binary (DLL init failure), so the REST
layer is implemented in `server/rest/index.ts` with security delegated entirely
to the database — translation only, never authorization.

### Provisioning the first operator

Sign up through the app's sign-in form, then promote that account once, in
the database (mirroring the hosted flow in docs/DEPLOYMENT.md):

```sh
npm run backend:promote -- you@example.com owner
```

(`npm run backend:promote -- you@example.com engineer` works for any role.)
`/admin` then opens for that account exactly as it does against hosted
Supabase — same RLS, same governance tables, same audit trail.

### Newsletter mail

Campaigns are drained by this backend over SMTP. The transport is off until
both a host and a From address are supplied, because the deployment cannot
invent a sender identity:

```sh
FOLIO_SMTP_HOST=smtp.example.com
FOLIO_SMTP_PORT=465            # 465 implicit TLS; 587 STARTTLS also works
FOLIO_SMTP_SECURE=true
FOLIO_SMTP_USER=newsletter@example.com
FOLIO_SMTP_PASS=…
FOLIO_SMTP_FROM="Example <newsletter@example.com>"
```

The admin console reports the transport as missing when either value is
absent, and the send route refuses with a written reason. Each delivery is a
row in `public.newsletter_deliveries`; a failed send records its error there
and can be retried without resending completed addresses. There is no
built-in From address and no fallback domain.

### The research tool

`GET /tools/fetch-text?url=<https://…>` fetches a public page and returns
bounded text (512 KB max, text-like content types only, 15 s timeout, no
cookies or credentials forwarded anywhere). It is what a datasheet or
reference lookup wants: the page is treated as untrusted data and returned
verbatim for Scribe's tools to read with their own eyes. It is **not** an
open proxy — http/https only, loopback only like the rest of this process,
no credentials. It remains available only when this backend is the one being
used; the hosted deployment does not expose it.

### Honest limits

- **Single connection.** PGlite serves one session; the backend multiplexes
  request transactions over it. Fine for a personal deployment, not a team
  server — for that, point `FOLIO_PG` at a real PostgreSQL.
- **Email + password only.** OAuth (Google/GitHub) needs a hosted identity
  provider with registered apps; against this backend those buttons reach a
  clear "not available" page, never a fake consent flow. Email confirmation
  is disabled by design; accounts are autoconfirmed. Newsletter campaigns use
  the separate SMTP transport described above.
- **No websockets.** Supabase Realtime is not part of this backend; the
  collaborative-editing panel stays local-only here, exactly as it does on
  hosted deployments without the realtime service.
- **localhost only.** `server/index.ts` binds 127.0.0.1. The dev
  JWT secret is public knowledge by definition — override `FOLIO_JWT_SECRET`
  (and set `FOLIO_PG`) for any deployment beyond one machine. This backend
  is a development and self-hosting tool, not a managed offering.

### Resetting

```sh
npm run backend:reset    # deletes .backend/pglite-data
npm run backend          # re-applies everything from scratch
```

---

## Infrastructure, source control, storage and hosting

This document records where Folio's code and design data actually live, what the
optional cloud pieces are for, and which parts are still a deployment task. It
is deliberately factual: anything marked **cloud deployment task** is not shipped
in this repository.

Verified against the working tree on 2026-10-26.

### 1. Source control (the code)

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

#### Design version control inside the app

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

### 2. What cloud storage is for

Supabase is optional. With no `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (the migrated `VITE_*` names still work as
aliases), every feature that needs persistence falls back to local storage and
the app remains fully usable offline.

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

Several migrations add the administration directory, capabilities and
operator-owned public content:

| Migration | Purpose |
| --- | --- |
| `20261026120000_admin_governance.sql` | `profiles`, `usage_events`, `quota_policies`, the new-user trigger and quota triggers |
| `20261121120000_capability_iam.sql` | `role_capabilities`, `has_capability()`, the capability-checked profile guard and governance policies |
| `20261121130000_legal_pages.sql` | `legal_pages` with anonymous reads and `content.manage` writes |
| `20261121140000_site_settings.sql` | `site_settings` with anonymous reads and `content.manage` writes |
| `20261121150000_rich_text_and_identity.sql` | The rich-text section conversion and the newer identity columns |

| Table | Purpose |
| --- | --- |
| `profiles` | Role (owner/admin/engineer/viewer), status and last-seen per auth account |
| `role_capabilities` | One row per capability granted to a role; migration-owned |
| `usage_events` | Append-only ledger written by the client recorder and quota triggers |
| `quota_policies` | Per-role project, export, simulation and storage limits (`NULL` = unlimited) |
| `legal_pages` | Operator-edited about/terms/privacy/security copy as a rich-text document |
| `site_settings` | One row of product identity, contact and source links |
| `admin_audit` | Append-only record of operator actions |

The capability migration installs the capability-checked RLS policies, the
profile guard, and the owner-only rule for `operators.manage_owner`. Local mode
does not need this schema. Apply it and promote the first owner as described in
[the console and governance](#admin-console-and-governance); invitations still require a service-role
server function and are intentionally absent from the browser.

Cloud storage is therefore for: account-backed projects, shared/multi-device
design data, the standard part library, and governance/usage records. The
built-in agent runner keeps its job ledger on local disk by default
(`FOLIO_AGENT_RUNNER_DATA`); a deployment that needs the ledger in Postgres can
implement the small `CloudJobStore` interface instead. The repository does not
upload Gerber/STL/SVG outputs anywhere; those are downloaded by the browser.

Optional real-time collaboration uses Supabase Realtime presence/broadcast when
configured. The sharing/role UI works locally, but live presence is cloud-only.

#### Agent runner

Always-on agents run on the built-in server runner under
`app/api/v1/agent/` (core in `src/lib/agents/server/`). It keeps a durable queue
in `FOLIO_AGENT_RUNNER_DATA` (default `./.folio-agent/jobs.json`), executes jobs
on a headless `createMemoryCadRuntime` with the same solver as the browser, and
records an event stream the client polls or streams. It is off until enabled and
supports three credential modes: per-user HMAC tokens minted after verifying a
Supabase session, a shared deployment key, or explicit same-origin trust for a
single-tenant install. The protocol, enabling steps and limits are in
[Always-on agents](#always-on-agents-local-loop-built-in-runner-wire-contract).

What the bundled runner does **not** provide: multi-tenant sandbox isolation, a
distributed queue, per-job CPU accounting, plan quotas or an approval inbox.
Those are deployment tasks. The single-tenant default is one process, one worker
and a file ledger; run it in a container with durable storage when the ledger
must survive redeploys, and implement `CloudJobStore` over your database for
multi-instance scheduling.

### 3. Hosting topology that fits this app

Folio is a Next.js 14 App Router application. `npm run build` produces `.next/`
and `npm start` serves it (port 5174 by default). The App Router pages and the
`/api/*` routes share one Node process, so a static file host alone is not a
complete target.

1. **Next.js host** — Vercel natively, or a Node container on Fly.io, Railway,
   Cloud Run or a VPS. Requirements: HTTPS, Node 20.19+, and a durable mounted
   volume if the built-in agent runner is enabled. Estimated cost: **$0–20/month**
   at low traffic.
2. **Managed Postgres + auth + storage** — Supabase (free tier for development;
   paid plan roughly $25/month once a project needs daily backups and higher
   limits). This replaces the local-storage fallback with accounts, RLS and
   multi-device persistence.
3. **Built-in agent runner** — included in the Next process for a single-tenant
   install, so there is no second service to pay for. For multi-tenant or
   sustained always-on work, run the runner in its own container with
   `FOLIO_AGENT_RUNNER_DATA` on durable storage, a database-backed
   `CloudJobStore`, and sandbox/CPU/memory limits. Expect roughly
   **$5–40/month** at low volume, dominated by CPU seconds when jobs run.
   Designs are CPU-bound simulation and routing work, not GPU work.
4. **Object storage for winners and audit logs** — Supabase Storage or
   Cloudflare R2 (R2 has no egress fee), only if a deployment chooses to persist
   those artifacts. The repository does not upload them today.

A realistic starting bill is **$0–30/month** for the Next host plus database,
rising to roughly **$50–150/month** with a dedicated always-on runner and
moderate job volume. Provider prices change; treat these as order-of-magnitude
planning figures, not quotes.

#### URL scheme and why the workbench stays one app

Every workspace is a route inside one client mount because the schematic, routed
board, undo history, agent sessions and WebGL contexts are live shared state. A
multi-page app would reload that state on every handoff (route → 3D → agent);
several mounts would duplicate the framework and vendor chunks. Workspaces are
already split with `React.lazy`, so first paint carries the shell and the active
panel only.

| Path | Screen |
| --- | --- |
| `/` | the public website (`app/page.tsx`) |
| `/pricing` | dedicated pricing page (`app/pricing`) |
| `/app` | project landing, or the open project's schematic — the CAD gate |
| `/app/projects` | project list |
| `/app/projects/:projectId` | that project's schematic |
| `/app/projects/:projectId/<workspace>` | e.g. `/app/projects/abc/pcb`, `/app/projects/abc/agents` |
| `/app/<workspace>` | workspace before a project is chosen (e.g. `/app/agents`) |
| `/console` | user console — profile, usage, plan & limits, local data |
| `/admin` | staff console |
| `/api/mcp` | optional headless MCP tool endpoint (key-gated) |
| `/api/v1/agent/*` | built-in always-on runner (off until enabled) |

The product lives under `/app` so the public site can own the root. Paths use
the History API, so there is no `#` in the address bar; reload and Back/Forward
preserve the workspace and project. Old `#/pcb?project=abc` bookmarks are
rewritten once on boot. Offline deep links reopen the local project directly;
cloud projects wait for sign-in. Unknown paths on the CAD mount normalise to
`/app/projects`; unknown paths outside it are handled by the Next not-found page.

#### Why not a cloud desktop / VPS per user?

The CAD environment is a browser app and all interactive solvers run in the tab.
A per-user virtual desktop would add cost and latency without improving the
human workflow. The genuinely server-side pieces are the optional MCP endpoint
and the headless agent runner — a queue and a CPU worker, not a remote desktop.

### 4. Deployment checklist (not yet executed)

- [ ] Create the Supabase project, set `NEXT_PUBLIC_SUPABASE_URL` and
      `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the legacy `VITE_*` aliases), run
      `npm run db:push` (or `db:reset` locally).
- [ ] Promote the first governance owner
      (`update public.profiles set role = 'owner' where email = '…';`) and open
      `/admin`; see [the console and governance](#admin-console-and-governance).
- [ ] Build and serve the Next app (`npm run build` then `npm start`, or the
      host's native Next integration). Do not upload a `dist/` directory; it is
      not produced.
- [ ] Add the deployment origin to Supabase auth redirect URLs.
- [ ] To offer always-on agents, set `FOLIO_AGENT_RUNNER_SECRET` (with Supabase
      configured for token minting), or a shared key / explicit same-origin
      trust for a single-tenant install, and set
      `NEXT_PUBLIC_AGENT_CLOUD_URL=/api`. Point
      `FOLIO_AGENT_RUNNER_DATA` at a durable volume. Never put a service-role
      key in a `NEXT_PUBLIC_*` variable.
- [ ] Configure backups and retention for Postgres, design artifacts and the
      runner ledger.
- [ ] Keep `npm run verify` green before publishing a build.

### 5. Standalone guarantees

Without any environment variables, the following work with no network:

- Schematic capture, PCB layout/routing, DRC/EMC/thermal/SI checks, Gerber and
  fabrication package export.
- SPICE simulation (DC, sweep, transient, AC, noise, Monte Carlo, mixed-signal).
- Mechanical CAD, third-angle part drawings, STEP/STL/OBJ/GLTF export.
- In-app VCS, backups, imports/exports and the demo gallery.
- The local autopilot loop, while the tab remains open.

The administration console labels this deployment **Standalone**. Cloud-labelled
actions either become available when configured or report that the deployment is
missing; they do not silently pretend to succeed.

---

## Always-on agents: local loop, built-in runner, wire contract

Folio runs agent design loops **locally in the browser** by default. That is
enough for a single interactive engineer or an agent working in the open tab:
every tool call drives the real canvas store, and simulation/margins/ERC run in
the same process.

It also ships a **server-side runner** for jobs that must keep running after the
tab closes. The runner lives in `src/lib/agents/server/` and is exposed by the
Next.js routes under `app/api/v1/agent/`. It is a real, durable worker — not a
protocol stub — with honest operational limits described below.

### Three ways to run agents

| Mode | Lives in | Survives a closed tab | Setup |
| --- | --- | --- | --- |
| Local autopilot | browser tab | no | none |
| Local background queue | browser tab (recovered on next start) | no (paused) | none |
| Built-in server runner | the Next.js Node process | yes | enable it, below |
| External runner | your infrastructure | yes | implement the protocol, point the client at it |

Everything shares one engine: `runAutopilot` (deterministic measured search)
and `runAgentLoop` (model-driven observe → decide → act). The built-in server
executor runs `runAutopilot` on a headless `createMemoryCadRuntime` built from
the submitted sheet; it does not reimplement the solver. Model-driven
`runAgentLoop` planning still runs in the browser (or in an external runner that
supplies a model), because a hosted model credential is not part of this job
payload.

### Enabling the built-in runner

The runner is **off until configured**. Pick one authentication mode:

#### 1. Per-user tokens (multi-tenant, recommended for a hosted deployment)

```dotenv
FOLIO_AGENT_RUNNER_SECRET=<long random value>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_AGENT_CLOUD_URL=/api
```

The browser calls `POST /api/v1/agent/token` with its Supabase access token.
That route verifies the session against Supabase, then signs a short-lived
(15 minute) HMAC token naming that user. Every job stores its owner, and a token
holder can only read or cancel its own jobs. The runner secret never reaches the
browser.

#### 2. Shared deployment key (one operator or machine-to-machine)

```dotenv
FOLIO_AGENT_RUNNER_KEY=<long random value>
NEXT_PUBLIC_AGENT_CLOUD_URL=/api
NEXT_PUBLIC_AGENT_CLOUD_TOKEN=<the same value>
```

Every holder can see every job. This is convenient for a single-tenant install
and wrong for several untrusted users; use per-user tokens there.

#### 3. Same-origin trust (single-tenant self-hosted)

```dotenv
FOLIO_AGENT_RUNNER_ENABLED=1
FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN=1
NEXT_PUBLIC_AGENT_CLOUD_URL=/api
```

A request is accepted only when it carries `x-folio-runner: 1` **and** the
browser reports `Sec-Fetch-Site: same-origin` (or its `Origin` host equals
`Host`). A cross-site form, image or navigation cannot set the custom header, so
this is a CSRF boundary. It is **not** authentication: a direct HTTP client can
spoof both headers, which is why it is only for an install whose network already
trusts every caller. Use mode 1 or 2 on a network-exposed deployment.

#### Enabling is explicit

`FOLIO_AGENT_RUNNER_ENABLED=1`, a key, or a secret switches the runner on. With
none of them, every job route returns `503 agent_runner_disabled` and the client
reports that cloud agents are unavailable while local autopilot still works.

### Optional runner tuning

| Variable | Default | Meaning |
| --- | --- | --- |
| `FOLIO_AGENT_RUNNER_DATA` | `./.folio-agent` | Directory for `jobs.json` |
| `FOLIO_AGENT_RUNNER_CONCURRENCY` | `1` | Jobs measured in parallel |
| `FOLIO_AGENT_RUNNER_MAX_WALL_MS` | `900000` | Hard cap a request cannot raise (15 min) |
| `FOLIO_AGENT_RUNNER_MAX_EVENTS` | `2000` | Events retained per job (ring) |

The request's own budget is also enforced and is clamped to these caps. Jobs and
their event logs persist across a restart: a job that was `running` is requeued
once the process is back. A job that has already been recovered twice is marked
`failed` rather than looping forever.

### Operational limits (honest)

The bundled runner is one Node process:

- **One queue, one worker by default.** A heavy solve competes with request
  handling; raise `FOLIO_AGENT_RUNNER_CONCURRENCY` only on a machine sized for
  it.
- **File persistence, not a database.** Writes go through write-then-rename so a
  kill cannot truncate the ledger, but there is no replication. Point
  `FOLIO_AGENT_RUNNER_DATA` at durable storage, or implement `CloudJobStore`
  over your database.
- **No sandbox.** A job is ordinary code in the server process. Multi-tenant
  deployments that accept untrusted goal/design payloads should run the runner
  in a container or VM with CPU/memory/wall limits; the runner's clamps are a
  budget, not a security boundary.
- **No plan quotas or billing.** Auth is identity; limits are deployment policy.
- **Cancellation is cooperative.** The abort signal is checked between measured
  candidates, so one in-flight simulation may finish first. The final state is
  still `cancelled`, and a partial result is not presented as success.
- **`approvalMode: "auto"` only.** The bundled runner has no approval inbox, so
  submitting `"on-write"` is rejected with `422 approval_not_supported` rather
  than silently auto-approving. An external runner may implement the gate.
- **Event history is capped.** Older events are evicted from the ring, so a
  client that reconnects with a very old cursor receives only what remains.
- **Same solver version required.** The runner and the browser build must be
  served from the same deployment. A solver change can alter measurements.

What remains genuinely absent: multi-tenant sandbox isolation, a distributed
queue, per-job CPU accounting, object storage for winner designs, OAuth scopes,
and an approval UI. Those are deployment work, not hidden features.

### HTTP API

All routes are Node-runtime and dynamic. Base URL is the deployment origin plus
`/api` when `NEXT_PUBLIC_AGENT_CLOUD_URL=/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/agent/jobs` | Submit a job (idempotent) |
| `GET` | `/v1/agent/jobs/{jobId}` | Status, progress, result |
| `GET` | `/v1/agent/jobs/{jobId}/events?after={seq}` | Event history, or SSE with `Accept: text/event-stream` |
| `POST` | `/v1/agent/jobs/{jobId}/cancel` | Cooperative cancel |
| `GET` | `/v1/agent/health` | `{ enabled, protocol }` capability probe |
| `POST` | `/v1/agent/token` | Exchange a verified Supabase session for a runner token |

Authentication header: `x-api-key: <credential>` or
`Authorization: Bearer <credential>`. The token route takes the **Supabase**
access token as its bearer, not a runner token.

### Protocol

Schema: `folio.agent-job/1`.

#### Submit a job

`POST /v1/agent/jobs`

```json
{
  "schema": "folio.agent-job/1",
  "clientJobId": "session-1730000000000-1",
  "title": "Ripple tuner",
  "projectId": "optional-project-id",
  "goal": {
    "description": "Minimise output ripple",
    "analysis": { "type": "transient", "stopTime": 0.004, "stepTime": 0.00001 },
    "metric": { "waveform": "V(OUT)", "statistic": "ripple", "settled": true },
    "knobs": [{ "reference": "C1", "property": "value", "from": 0.000002, "to": 0.00047, "scale": "log" }],
    "constraints": { "requireErcPass": true, "requireAllRated": true }
  },
  "design": { "components": [], "wires": [] },
  "firmware": "",
  "budget": { "maxCalls": 100, "maxWallMs": 300000 },
  "approvalMode": "auto",
  "createdAt": "2026-10-24T00:00:00.000Z"
}
```

`clientJobId` is the idempotency key: re-submitting it returns the original job
and does not start a second run. The request is validated as untrusted input
(schema, analysis type, metric shape, component/wire shapes and ceilings) before
it becomes durable. `design.components` is capped at 5,000 and `design.wires` at
20,000.

Response: `201` for a new job, `200` for an idempotent replay.

```json
{ "jobId": "job-9", "state": "queued" }
```

#### Poll status

`GET /v1/agent/jobs/{jobId}`

```json
{
  "id": "job-9",
  "state": "running",
  "createdAt": "2026-10-24T00:00:00.000Z",
  "updatedAt": "2026-10-24T00:01:10.000Z",
  "progress": { "step": 12, "total": 40, "message": "Sweeping C1" },
  "result": {
    "achieved": true,
    "reason": "Target met: Ripple 0.0100 V (target 0.0200 ± 0.0050) at C1.value = 0.000047.",
    "fingerprint": "abc123",
    "bestIteration": 7,
    "bestMetric": 0.01,
    "metricLabel": "Ripple",
    "metricUnit": "V",
    "values": { "C1.value": 0.000047 }
  }
}
```

States: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `expired`.
The last four are terminal. `result` is present when the executor produced one;
`achieved: false` with a reason is a real answer, not a failure of the runner.

#### Events

`GET /v1/agent/jobs/{jobId}/events?after={seq}`

```json
{
  "events": [
    {
      "seq": 12,
      "at": "2026-10-24T00:01:10.000Z",
      "type": "iteration",
      "message": "Best point",
      "iteration": 7,
      "phase": "sweep",
      "metric": 0.01,
      "metricLabel": "Ripple",
      "metricUnit": "V",
      "goalMet": true,
      "fingerprint": "abc123"
    }
  ]
}
```

Event types: `status`, `observation`, `tool`, `iteration`, `log`, `result`,
`error`. `after` is exclusive; the response contains `seq > after`. The client
also sends `Last-Event-ID` when resuming.

With `Accept: text/event-stream`, the same endpoint streams
`id: <seq>` + `data: {event}\n\n` frames and ends with `data: [DONE]\n\n`. A
terminal job closes the stream. The browser client consumes both forms and
leaves an explicit `Accept` header intact.

#### Cancel

`POST /v1/agent/jobs/{jobId}/cancel`

Returns `{ jobId, state }` on success and `409` for an already-terminal job
(history is not rewritten). Cancellation stops before the next measurement, as
described above.

### External runner compatibility

An external worker can implement the protocol above and be used without the
bundled runner. Set `NEXT_PUBLIC_AGENT_CLOUD_URL` to its absolute HTTPS origin.
If it does not mint per-user tokens, provide a short-lived
`NEXT_PUBLIC_AGENT_CLOUD_TOKEN`; that value is compiled into the public bundle,
so never put a long-lived service credential there.

### MCP endpoint (`/api/mcp`)

Folio also ships a minimal, headless MCP-facing endpoint at `/api/mcp`. It is
**disabled unless `FOLIO_MCP_KEY` is configured**; with no key set, every
request is refused with `503 mcp_disabled`. With the key set, clients
authenticate with `x-api-key: <FOLIO_MCP_KEY>` and may call:

| Method | Purpose |
| --- | --- |
| `tools/list` | Tool registry — exactly the three tools below |
| `tools/call` | Execute one of them |

Tools exposed today (all headless, no browser required):

| Tool | What it does |
| --- | --- |
| `component_search` | Keyword search over the built-in standard component library — returns category, name, default properties. Nothing invented; unmatched queries return an empty match list. |
| `netlist_verify` | Parse a full SPICE deck; report parsed element counts, nets, import errors and warnings. Refuses decks the simulator cannot really run. |
| `circuit_simulate` | Run `transient`, `dc`, `dc-sweep`, `ac`, `noise` or `montecarlo` on a deck; returns per-waveform statistics (min/max/peak-to-peak/mean/rms). |

What it does **not** do yet, honestly: `resources/*`, `prompts/*`, `completion/*`,
sampling, live project access (canvas, demo state, fab gate), mutation of designs
(work is in-progress via `src/lib/agents/cadTools.ts` which requires the browser
runtime), OAuth scoping per-tool, rate limiting beyond key auth, and multi-user
authz. Treat `/api/mcp` as a headless tool endpoint, not an agentic platform.

### What works locally (no server)

| Capability | Where |
| --- | --- |
| Observe sheet as canonical snapshot + SVG | `src/lib/agents/designSnapshot.ts`, `cad.observe` |
| Add/move/remove parts, wire pins, name nets, T-tap rails | `src/lib/agents/cadTools.ts` |
| DC / transient / AC / noise / sweep / Monte Carlo simulation | `cad.simulate` |
| Declared-rating margins, thermal estimate, limiting factor | `cad.assess`, `src/lib/electronics/designMargins.ts` |
| ERC, SPICE export, firmware edit, undo | `cad.erc`, `cad.exportNetlist`, `cad.setFirmware`, `cad.undo` |
| Observe → decide → act loop with budgets and approvals | `src/lib/agents/autopilot.ts` (`runAgentLoop`) |
| Deterministic bounded knob search with restore-best | `runAutopilot` |
| Durable session timeline (localStorage) | `src/lib/agents/agentSession.ts` |
| Autopilot UI with live schematic/waveform feedback | `src/components/ecad/AgentPanel.tsx`, `src/components/ecad/agent/AutopilotWorkbench.tsx` |
| Persistent background job queue: plan → act → verify → report, pause/resume/cancel, approval gates, per-step persistence, crash recovery, token-budgeted context pack | `src/lib/agents/jobRunner.ts`, `src/lib/agents/jobExecutor.ts`, `src/lib/agents/contextPack.ts`, `src/components/ecad/agent/JobRunnerPanel.tsx` |

Limits of the local runner: the tab must stay open — closing it pauses the
active job, which the queue recovers as paused on the next start and resumes
from its last completed step; nothing executes while the app is closed;
simulations compete with rendering for one thread; and there is no multi-user
scheduling or server-side audit retention. Use the built-in server runner for
those.

---

## Authentication — how signing in works on this deployment

Folio ships in two build modes. Which one you get is decided at build time by two environment variables and nothing else — there is no checkbox at runtime, and no way for the client to "become" the other mode.

| | Standalone build (default) | Cloud deployment |
|---|---|---|
| How you "sign in" | Not at all — no gate, no prompt, ever | Your account (email + password or an OAuth provider) |
| Where your identity lives | `localStorage['folio-local-profile']` on this browser only | Supabase Auth (`auth.users`) |
| Where your projects live | This browser (`folio.offlineProjects`) | Postgres, row-level-secured to your user id |
| Where the door is | No door — the first run silently creates the device default identity (`ensureDefaultProfile`) | `AuthForm` — renders in `/console` and in the workbench when there is no session |
| Network calls when signed in | Zero. Nothing leaves the machine. | Signed in to Supabase only. |
| Cost | Free | Your Supabase project |

The build flag: `isSupabaseConfigured` in `src/lib/cloudConfig.ts` is true only when `NEXT_PUBLIC_SUPABASE_URL` (or the legacy `VITE_SUPABASE_URL` alias) parses as an `https?://` URL and the matching anon key is set to something other than the placeholder. Anything else — missing, malformed, the shipped `your_supabase_project_url` — silently selects the standalone mode. **Silence is deliberate:** a half-configured cloud build must not open an admin console to the world.

### The standalone mode, answered honestly

There is no sign-in screen in the standalone build, by deliberate contract. The first time the app opens it silently creates a local identity called "Workspace" (idempotent — later runs reuse it, and if you had deactivated one, the most recent is reactivated). That identity stamps your commits and checkpoints; it is not a credential and nothing about it is checked. There is no cupboard to lock and no door to guard, so the build does not pretend otherwise. The local profile store still exists for machines shared by more than one person (the console can switch/forget profiles), but it never stands between you and the workbench.

When the product needs a shared account surface, you configure the cloud build (below) and the hosted sign-in appears there instead.

### The cloud build — exact steps

Prerequisites: a Supabase project (free tier works), the Supabase CLI, and Docker for the local verification loop. Nothing here is automatic — by design, because guessing a project owner would hand the deployment to the wrong person.

1. **Create the project** at `supabase.com` (or `supabase init` + `supabase start` for a local one).
2. **Apply the schema and the policies:**
   ```sh
   supabase link --project-ref <your-ref>
   supabase db push
   ```
   That applies `supabase/migrations/20251018170350_create_circuit_cad_schema.sql` (the CAD schema with its own-row RLS on every table) and the governance/operator migrations after it.
3. **Set the build environment:**
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
   Rebuild. The site now shows the hosted sign-in instead of the workbench.
4. **Create the first account** through the sign-in form itself (email + password, or Google/GitHub if you enable those providers in the Supabase dashboard).
5. **Promote the first operator** — the migration deliberately does not guess an owner. Until you do this once, every new account is a `viewer`. Run it as the database superuser (the Supabase SQL editor, or the local backend's `npm run backend:promote -- you@example.com owner`); the `guard_profile_changes()` trigger refuses every API role and exists to stop API-driven escalation, so it only yields to `postgres`/`service_role` — which is exactly what the SQL editor is, and why API clients cannot perform this update.
   ```sql
   update public.profiles set role = 'owner' where email = 'you@example.com';
   ```
   Whoever runs this is the owner. Subsequent promotions go through the operator console (`/admin`), never through this manual update — the owner role is self-demotion-proof and reserved to owners.

The local self-hosted backend documented in [DEPLOYMENT.md](DEPLOYMENT.md#the-local-folio-backend) follows this exact contract: the one account you promote is the owner for `/admin`, and every other account is a viewer until you promote it.

### Row-level security

Every table that holds user data has RLS enabled, and every policy keys off `auth.uid()`:

- `projects`, `schematics`, `placed_components`, `wires` — owner-or-nothing; child tables resolve ownership through their parent (`schematics` checks the owning project, `placed_components`/`wires` check the owning schematic).
- `components` — standard library rows are visible to everyone; your own creations and your own private copies are visible to you alone.
- `profiles`, `quota_policies`, `admin_audit`, and the governance tables — operator-only, gated by the `profiles.role` row, never by client code. Reads are operator-only, writes are operator-only, and the audit trail is append-only.

The client never decides what you may see. The database does.

### Session behaviour

- The workbench and the console restore the session on load (`supabase.auth.getSession()`), and re-check it live (`onAuthStateChange`). Signing out in one tab signs out the other on its next render.
- Passwordless OAuth (Google, GitHub) returns to the same origin; if a provider is misconfigured, the form surfaces Supabase's error text verbatim — it never shows a spinner forever.
- Sign-up with email confirmation enabled tells you exactly what happened: "Confirm <email> using the link we sent, then sign in." It does not pretend you are signed in.
- Signing out in the cloud console returns you to the hosted sign-in; nothing else on the device is touched. The standalone console has no sign-out at all — there is no session to end — and says so instead of showing a dead button.

### Verification status, stated plainly

- The client flow is covered by tests: 11 `AuthForm` tests (validation, mode switching, error surfacing, OAuth dispatch, the email-confirmation case), the console tests in `consoleApp.test.tsx`, and `standaloneBoot.test.tsx`, which pins the no-gate contract — the workbench opens with no sign-in screen and no name prompt, creating the device default identity exactly once.
- The RLS policies are in the migrations and read exactly as documented above. They are applied by `supabase db push` — there is no weaker fallback anywhere: a table without its policy is unreadable, not public.
- **What has not been run:** `supabase start` in this workspace has no Docker and no cloud project, so a full sign-up → sign-in round trip against a live instance has not been executed here. Everything that can be checked without a network has been. The one live-machine step is your step 1–5 above.
- Nothing in the offline mode is fake. If `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (or their `VITE_*` aliases) are absent, no network call is ever made and the console shows a local ledger that every number in it was computed on this device.

---

---

## Admin console and governance

### Opening the console

There is no local mode and no default administrator in the build. Without
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the legacy
`VITE_*` aliases), `/admin` renders a “No deployment to operate” screen naming
the variables to set. It does not create a directory, a session or an audit
trail of its own.

With a deployment configured, authority is the account's row in
`public.profiles`:

- `role` must be `owner` or `admin`;
- `status` must be `active`;
- row-level security on every table the console reads enforces the same rule,
  so a browser that lost its membership still gets a refusal from Postgres.

The bootstrap is deliberately outside the browser. The documented first-owner
step uses the service role in the SQL editor; see
[DEPLOYMENT.md](DEPLOYMENT.md). Invitations are **not shipped**: creating an
account needs the identity service's admin API and a service-role key, which
must never reach a browser. The Accounts section says so instead of showing a
button that cannot work.

### Capabilities

Roles are product-defined. The matrix is stored in
`public.role_capabilities` and checked by `public.has_capability()`; the same
matrix in `src/lib/admin/permissions.ts` lets the console explain itself and
refuse a call before sending it. Changing the matrix is a migration decision —
an operator cannot edit it from the console, because a role that can revoke its
own administration is a way to lock a deployment out. The editable axis is who
holds which role, and that change is audited.

| Capability | Owner | Administrator |
| --- | --- | --- |
| `console.access` — open the console | yes | yes |
| `accounts.read` — read the directory | yes | yes |
| `accounts.manage` — change roles, suspend/restore | yes | yes |
| `operators.manage_owner` — grant or change owners | yes | no |
| `usage.read` — read the usage ledger | yes | yes |
| `quotas.read` — read quota policy | yes | yes |
| `quotas.manage` — edit engineer/viewer policy | yes | yes |
| `audit.read` — read the audit trail | yes | yes |
| `audit.write` — append operator actions | yes | yes |
| `content.manage` — edit FAQ, legal pages, site identity, testimonials | yes | yes |
| `newsletter.read` — read subscribers and campaigns | yes | yes |
| `newsletter.manage` — create/delete campaigns, remove subscribers | yes | yes |
| `newsletter.send` — start the SMTP drain | yes | yes |
| `deployment.read` — read deployment aggregates | yes | yes |
| `data.export` — download visible rows as CSV | yes | yes |

`engineer` and `viewer` are workbench roles with no console capability. An
account with no role is treated as a viewer by the quota policy, but it cannot
open the console.

The pre-flight guard is not the security boundary. Row-level security and the
profile trigger remain authoritative; the guard exists so an operator gets a
sentence they can act on instead of a raw database error.

### The sections

| Group | Section | What it is for |
| --- | --- | --- |
| Operations | **Overview** | Deployment totals, activity, role mix, account growth, accounts near a limit, and recent operator actions. |
| Operations | **Accounts** | The directory: role, status, last recorded activity, search, filters and CSV export. |
| Operations | **Roles & access** | The capability matrix, who holds an operator role, and how authority is enforced. |
| Insights | **Usage** | The deployment usage ledger, filtered by kind and window, with per-account rollups. |
| Insights | **Quotas** | The stored limits for engineer and viewer, and today's usage against them. |
| Governance | **Audit trail** | The append-only record of operator actions, newest first, with CSV export. |
| Content | **FAQ** | Questions and answers shown on the public site. |
| Content | **Legal pages** | The about, terms, privacy and security pages, edited as rich text. |
| Content | **Site identity** | Product name, company, tagline, default description, canonical origin, contact and source links. |
| Content | **Testimonials** | Curated quotes shown on the public site. |
| Content | **Newsletter** | Subscribers, campaigns and the SMTP drain. |
| System | **Deployment** | The host, the runner configuration and what the aggregate read can see. |

The console opens on **Overview**. A count is only shown when the corresponding
read succeeded; a failed read states the database error instead of drawing a
measured zero.

### Roles and default quotas

| Role | Projects | Exports / day | Simulations / day | Storage (advisory) |
| --- | --- | --- | --- | --- |
| Owner | unlimited | unlimited | unlimited | unlimited |
| Administrator | unlimited | unlimited | unlimited | unlimited |
| Engineer | 100 | 200 | 1,000 | 2,048 MB |
| Viewer (and unassigned accounts) | 3 | 20 | 50 | 100 MB |

A blank limit means unlimited. Owner and administrator limits are fixed at
unlimited in the console and by the schema, so an administrator cannot lock the
deployment out of administration. Storage is a policy figure: the server does
not measure a browser's disk, and the console says so rather than presenting an
invented number as telemetry.

Quota edits write to `public.quota_policies` and are audited. If the write is
refused, the console reports the refusal; it does not claim a device-local
change succeeded.

### Public content

Content is data, not bundle copy. The public site reads it anonymously; writes
require `content.manage` and are audited.

#### Legal and company pages

`public.legal_pages` holds one row per route: `about`, `terms`, `privacy` and
`security`. The slug is the primary key and the URL segment, so the set of
pages is fixed; an operator edits what each page says, not which routes exist.

Each section is:

```json
{
  "heading": "What Folio is",
  "body": [
    { "type": "paragraph", "runs": [{ "text": "A single instrument, not a pile of tools." }] },
    { "type": "paragraph", "runs": [{ "text": "team@example.com", "href": "mailto:team@example.com" }] }
  ]
}
```

`body` is a rich-text document, not an HTML string. Blocks are paragraphs,
headings (`level` 2 or 3), quotes, and ordered or unordered lists. Runs carry
optional `bold`, `italic`, `underline`, `strike`, `code` and `href` fields.
Links survive only when they use `http://`, `https://` or `mailto:`.

The admin editor is a `contentEditable` surface with a formatting toolbar. On
save it reads the DOM back into this structure; it never writes raw HTML to the
database. The public renderer builds React elements from the structure and does
not use `dangerouslySetInnerHTML`. Pasting is reduced to plain text on purpose:
the toolbar is the way to add formatting.

If a deployment has no row for a route, the public page says it is not
configured. The build does not contain substitute legal copy.

#### Site identity

`public.site_settings` has exactly one row and is edited under **Site identity**:

- product name (required);
- company;
- tagline and default description;
- contact address;
- canonical site origin;
- GitHub and Codeberg links;
- security-policy link.

The shell, page metadata, `sitemap.xml`, `robots.txt` and the web manifest read
these values. An empty field is omitted from the page; the console never
substitutes a value the operator did not set. An unconfigured deployment
therefore returns an empty sitemap rather than advertising somebody else's
origin.

#### FAQ and testimonials

`public.faq_entries` is ordered by `position`, with `published` hiding a draft.
`public.testimonials` is curated the same way. Both are public reads; both are
`content.manage` writes. The public FAQ has no baked-in fallback: if no rows are
published, the section says so.

#### Newsletter

Subscribers and campaigns live in `newsletter_subscribers` and
`newsletter_campaigns`. Creating a campaign writes a draft and audits it. Sending
requires `newsletter.send`, the loopback backend and an SMTP host plus a From
address (`FOLIO_SMTP_HOST` and `FOLIO_SMTP_FROM`); if either is missing, the
panel says the transport is missing instead of queueing mail that will never
leave. The public subscribe endpoint is separate and does not require an
operator session.

### Audit and export

Every console mutation attempts an append to `public.admin_audit` in the same
call. If the mutation lands but the audit append is refused, the result is a
success **with a warning** naming the audit failure — never a clean success that
left no record. Actions include role and status changes, quota edits, content
edits, campaign creation and send attempts, subscriber removal, and the operator
opening the console.

`data.export` allows CSV download of the visible rows in Accounts, Usage and the
Audit trail. The export contains what the console can see under RLS, not a
server-side dump.

### Deployment report

The **Deployment** section shows the configured host, whether the always-on
agent runner is configured, and aggregates from
`public.admin_deployment_stats()` when that function answers. If it is missing
or refused, the section reports the failure and leaves the totals blank. It does
not infer totals from a partial read.

### Schema and migrations

| Migration | Purpose |
| --- | --- |
| `20261121120000_capability_iam.sql` | `role_capabilities`, `has_capability()`, capability-checked profile guard, governance policies. |
| `20261121130000_legal_pages.sql` | `legal_pages`, anonymous read policy, `content.manage` writes, rich-text seed. |
| `20261121140000_site_settings.sql` | `site_settings`, single-row constraint, anonymous read, `content.manage` writes, identity seed. |
| `20261121150000_rich_text_and_identity.sql` | Converts pre-rich-text legal sections, adds tagline/description/site URL, rewrites older policies. |

Reads of public content are granted to `anon`; operator tables are not. Never
put a service-role key in a `NEXT_PUBLIC_*` variable or any browser bundle.

### Honest limits

- Invitations are not implemented in the browser. Use the identity service's
  admin API from a trusted server, then assign the role in the console.
- Usage aggregation reads the most recent 10,000 matching rows per request. It
  is a console summary, not an analytics warehouse.
- Audit rows are durable only when the database accepts them. The console
  surfaces an audit failure as a warning rather than hiding it.
- Storage is an advisory policy limit, not a server measurement.
- The console cannot edit the capability matrix. That is deliberate. A new
  role or grant ships as a migration.
- Billing is not shipped. Plan copy and quotas are separate concerns; the
  console does not invent a subscription state.

### Verification

Run the targeted suites while working on the console:

```bash
npx vitest --run src/lib/admin/permissions.test.ts src/lib/admin/adminService.test.ts \
  src/lib/admin/analytics.test.ts src/lib/legal/legalPages.test.ts \
  src/lib/legal/richText.test.ts src/lib/site/siteSettings.test.ts \
  src/__tests__/linkIntegrity.test.ts src/__tests__/adminConsole.test.tsx
```

The full gate is `npm run verify` (typecheck, lint, accessibility scripts, the
test suite, and a production build).


---

## Security policy

### Supported versions

Only the `main` branch receives security fixes. There is no stable release line; the workbench is built from `main` and deployed from `main`.

### Reporting a vulnerability

Report privately via **GitHub private vulnerability reporting** on this repository (Security → Report a vulnerability). Do not open a public issue for an exploitable flaw, and do not test against deployments you do not own.

What to include: the affected surface (workbench, console, admin console, marketing site, build pipeline), reproduction steps, and the impact you observed. If you have a fix in mind, a sketch of it in the report is welcome.

What to expect: acknowledgement and an honest assessment. If the finding is reproducible and in scope, it is fixed on `main` and the advisory published; if it is not reproducible or not in scope, you will be told that plainly — no silent limbo.

### In scope

- The shipped Next.js routes under `app/` and the client bundles they load.
- The CSP and security headers (`middleware.ts`, `next.config.mjs`).
- The server endpoints: the built-in agent runner (`/api/v1/agent/*`) and the optional headless MCP endpoint (`/api/mcp`), including their authentication modes.
- Any path where user-controlled data reaches a device other than the one it is typed on: community payloads, publish imports, template files, the encrypted export.
- The local-first trust boundary: a project file, a `.folio.enc.json`, or a community payload must never execute code, leak `circuit-cad-app-store` beyond its intended scope, or overwrite an existing design silently.

### Out of scope

- Denial of service against the demo/marketing pages.
- Findings in accounts you do not own.
- Missing hardening headers on routes that serve no user data, beyond what is already configured — we do take those reports seriously when there is demonstrated impact.

### Design commitments the security review can rely on

- No third-party script is loaded from a CDN; everything is self-hosted under `/_next/static` and `/public`.
- No credentials leave the browser in a "download my data" export — Folio session keys are excluded by construction and by test.
- Community payloads are validated item-by-item and refused whole on any malformation; imports never destroy an existing design.
- Production dependencies are audited (`npm audit --omit=dev` is clean on `main`); the CI gate runs lint, the accessibility contract, the type-checker, the full test suite and a production build.

