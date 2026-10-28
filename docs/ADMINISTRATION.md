# Administration and governance

Verified against the working tree on 2026-10-28.

The administration console is a separate surface from the multi-domain CAD
workspace. It lives at `/admin` (header shield button, or the More menu on narrow
screens) and answers three questions: **who can use this deployment**, **what did
they use**, and **what limits apply**. It is intentionally not a CAD mode, so it
opens with or without a project loaded.

## What is implemented

| Capability | Local mode (no Supabase vars) | Cloud mode (Supabase configured) |
| --- | --- | --- |
| Access check | Device owner, always allowed | `profiles.role` is owner/admin and `status = active` |
| People list | One local owner | `profiles` rows, newest sign-ups included |
| Role changes | Not applicable (one owner) | Admin update, audited |
| Suspend/restore | Not applicable | Admin update; self-suspension refused |
| Invitations | Not applicable | **Not shipped** — needs a service-role server function |
| Usage ledger | Device-local, `folio.usage.v1` | Local ledger plus best-effort `usage_events` rows |
| Cloud usage feed | Not applicable | Aggregated from `usage_events` (last 10,000 rows) |
| Quota policies | Cached in `folio.quotas.v1` | Same cache, hydrated from and written back to `quota_policies` |
| Project quota | Enforced before a project is created | Enforced in the browser *and* by a Postgres trigger |
| Export / simulation quota | Enforced from the local ledger | Browser check plus a Postgres trigger on `usage_events` |
| Audit trail | SIEM in-memory trail (this session) | Same trail; role/quota changes are audited locally |
| Environment report | Storage estimate, runner capability | Same, plus governance table status |

The console never invents people, usage or remote actions. When the cloud
directory is unreachable it reports the database error and keeps the local view.

## Roles and default policies

| Role | Projects | Exports / day | Simulations / day | Storage (advisory) |
| --- | --- | --- | --- | --- |
| Owner | unlimited | unlimited | unlimited | unlimited |
| Administrator | unlimited | unlimited | unlimited | unlimited |
| Engineer | 100 | 200 | 1,000 | 2,048 MB |
| Viewer (and unassigned accounts) | 3 | 20 | 50 | 100 MB |

A blank limit means unlimited. Owner and administrator limits are fixed at
unlimited by the client and by the schema, so an administrator cannot lock the
deployment out of administration.

## Usage ledger

`src/lib/admin/usageLedger.ts` records these kinds:

- `workspace.open`, `demo.load`
- `project.create`, `project.open`
- `vcs.commit`, `export.run`, `simulation.run`
- `agent.run`, `onboarding.complete`, `onboarding.exit`, `admin.open`

`onboarding.exit` records a guide that was closed or skipped before the last
step; its detail carries `steps` (how many cards were actually opened), `total`
and the exit `reason`. A closed guide is never reported as a finished tour.

Properties:

- Append-only, capped at **5,000 events** per browser.
- Consecutive duplicates within 3 seconds (same kind, user and detail) collapse.
- Backdated events are preserved, not collapsed.
- Fully local: no analytics service, no third-party call.
- If the browser refuses `localStorage` (blocked or full), events stay in memory
  for the session and the Usage and Environment tabs say the ledger is not
  durable instead of implying it survives the tab.
- The Usage tab offers 7/14/30/90-day windows, a kind filter, CSV export, a daily
  chart, per-workspace and per-user totals, and a two-step "clear this device's
  ledger" action.
- Clearing is a **whole-ledger** action: the confirmation names the total number
  of stored events, not just the rows visible in the current window. Audit events
  are kept, and the clear itself is written to the audit trail.

In cloud mode `src/lib/admin/usageRecorder.ts` mirrors each event into
`usage_events`. Mirroring is best-effort: a failed insert never breaks the design
action, and the local ledger remains authoritative for the device. A failed
mirror is surfaced in the Usage tab, naming the database error, because the
cloud-wide report and the server-side quota trigger did not see that event.

## Quota enforcement

Browser-side checks run before the action:

- project creation (`App.handleNewProject`)
- every export format (`App.exportQuotaError` / `finishExport`)
- solver runs (`SimulationPanel` via `beforeRun` / `onRunComplete`)

The checked usage is the local ledger for the signed-in account, so it is exact
for this device and conservative across devices. Cloud enforcement is the
authority:

- `enforce_project_quota()` — `BEFORE INSERT ON projects`, counts the account's
  projects and raises when the role limit is reached.
- `enforce_usage_quota()` — `BEFORE INSERT ON usage_events` for `export.run` and
  `simulation.run`, counts today's events and raises at the daily limit.
- Storage is **not** enforced server-side. The console reports the browser's
  storage estimate and labels the storage row as advisory. When the browser
  provides no estimate, the row reads **Unavailable** and is not compared to the
  policy; a missing estimate is never rendered as zero usage.
- Cloud daily limits count from `date_trunc('day', now())` in the database
  session timezone (UTC by default), so a device in another timezone may see a
  day boundary that differs from its local ledger. The browser check uses the
  local calendar day; the server remains authoritative.

## Cloud schema

Migration: `supabase/migrations/20261026120000_admin_governance.sql`.

Tables:

- `profiles` — id (`auth.users`), email, display name, role, status, last seen.
- `usage_events` — append-only kind/detail/time rows.
- `quota_policies` — one row per role; `NULL` is unlimited.

Guards:

- `is_admin()` / `is_owner()` are `SECURITY DEFINER` helpers used by RLS.
- `guard_profile_changes()` blocks non-admin role/status edits, self-demotion and
  non-owner changes to an owner.
- `handle_new_user()` creates a `viewer` profile for every new auth account.
- RLS: profiles are visible to their account or admins; usage is visible to its
  account or admins and insert-only for clients; policies are admin-only.
- The ledger has no update or delete policy, so clients cannot rewrite history.

### Deployment steps

1. Apply the migrations: `npm run db:push`, or run both SQL files in the
   Supabase SQL editor.
2. Sign up the first account.
3. Promote it once with the service role (SQL editor or admin API):

   ```sql
   update public.profiles set role = 'owner' where email = 'you@example.com';
   ```

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, rebuild, and open
   `/admin`. Promote engineers with the People tab; they inherit the engineer
   policy immediately.
5. Keep service-role keys server-side. They must never appear in a `VITE_*`
   variable or in the browser bundle.

## Honest limits

- **Invitations are not implemented.** They need the Supabase admin API and a
  service-role key; the People tab says so rather than faking an email.
- Local mode cannot enumerate accounts on other devices, revoke a session
  remotely, or enforce a quota for someone else.
- Cloud usage aggregation reads the most recent 10,000 matching rows per request;
  it is a console summary, not an analytics warehouse.
- The SIEM audit trail is in-memory for the session unless a durable audit sink
  is configured. Usage events are the durable record.
- Quota policy changes are audited and, in cloud mode, written to
  `quota_policies`. If the cloud write fails, the console says the change is
  device-local instead of claiming success.

## Verification

- `src/lib/admin/usageLedger.test.ts` — dedupe, backdated events, cap,
  aggregation, malformed storage, and refused reads/writes reported as
  non-durable rather than silently lost.
- `src/lib/admin/quotaPolicy.test.ts` — defaults, parsing, persistence,
  enforcement decisions, status thresholds.
- `src/lib/admin/adminService.test.ts` — offline/cloud access resolution, missing
  schema, self-demotion guard, audit records, capability labels.
- `src/__tests__/adminConsole.test.tsx` — overview, people, usage, quota save,
  invalid limits, environment, back navigation, CSV download, whole-ledger clear
  scope, unavailable storage estimate and the non-durable ledger warning.
- `src/__tests__/adminMirrorError.test.tsx` — a failed `usage_events` mirror is
  reported in the Usage tab instead of looking like a successful sync.
- `src/__tests__/appShell.test.tsx` — `/admin` deep link, return to projects,
  launcher overlays, and workbench shortcuts being ignored on `/admin`.
- `src/stores/routing.test.ts` — `/admin` is recognised without becoming a
  workspace mode.
