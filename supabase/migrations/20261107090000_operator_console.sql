/*
  # Operator console

  The admin console is a separate application (`admin.html`) for the people who
  run Folio and manage the accounts that use it. It is not part of the workbench
  and holds no designer session: it signs in under its own storage key and its
  authority is the `profiles` row, exactly as `is_admin()` already defines it.

  This migration gives that console three things it cannot honestly invent in
  the browser:

  ## `admin_audit`
  Append-only record of what operators did — role changes, suspensions, policy
  edits, console opens. The previous console kept this in browser memory, which
  meant it only ever showed what one tab had done and vanished on reload.
  Clients may insert their own rows and read them only if they are operators;
  there is no update or delete policy, so the record cannot be rewritten.

  ## `admin_deployment_stats()`
  Deployment-wide counts. `projects` is protected by own-row RLS, so an operator
  counting projects through the table would silently count only their own.
  This `security definer` function returns aggregates and nothing else — no
  project names, no design data — and refuses callers who are not operators.

  ## Policy visibility
  Quota limits are product policy, not a secret: a signed-in account must be able
  to read the limits it is being held to, so the workbench can pre-check an
  action before spending the designer's time on it. Writes stay operator-only.
*/

-- ── Operator audit ──────────────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  resource text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_time on public.admin_audit(created_at desc);
create index if not exists idx_admin_audit_actor_time on public.admin_audit(actor_id, created_at desc);

alter table public.admin_audit enable row level security;

drop policy if exists "Operators can read the audit trail" on public.admin_audit;
create policy "Operators can read the audit trail"
  on public.admin_audit for select
  using (public.is_admin());

drop policy if exists "Operators can append their own audit rows" on public.admin_audit;
create policy "Operators can append their own audit rows"
  on public.admin_audit for insert
  with check (public.is_admin() and actor_id = auth.uid());

-- No update or delete policy: the trail is append-only for every client.

grant select, insert on public.admin_audit to authenticated;
grant usage, select on sequence public.admin_audit_id_seq to authenticated;

-- ── Deployment aggregates ───────────────────────────────────────────────────
create or replace function public.admin_deployment_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only operators can read deployment statistics';
  end if;

  select jsonb_build_object(
    'projects', (select count(*) from public.projects),
    'projectsByRole', coalesce((
      select jsonb_object_agg(role, total)
      from (
        select coalesce(p.role, 'unassigned') as role, count(*) as total
        from public.projects as projects
        left join public.profiles as p on p.id = projects.user_id
        group by coalesce(p.role, 'unassigned')
      ) as per_role
    ), '{}'::jsonb),
    'accounts', (select count(*) from public.profiles),
    'activeAccounts', (select count(*) from public.profiles where status = 'active'),
    'suspendedAccounts', (select count(*) from public.profiles where status = 'suspended'),
    'operatorAccounts', (select count(*) from public.profiles where role in ('owner', 'admin') and status = 'active'),
    'usageEvents', (select count(*) from public.usage_events),
    'auditEvents', (select count(*) from public.admin_audit),
    'exportsToday', (select count(*) from public.usage_events where kind = 'export.run' and created_at >= date_trunc('day', now())),
    'simulationsToday', (select count(*) from public.usage_events where kind = 'simulation.run' and created_at >= date_trunc('day', now()))
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_deployment_stats() from public, anon;
grant execute on function public.admin_deployment_stats() to authenticated;

-- ── Policy visibility for the accounts being limited ────────────────────────
drop policy if exists "Policies are visible to admins" on public.quota_policies;
drop policy if exists "Policies are visible to signed-in accounts" on public.quota_policies;
create policy "Policies are visible to signed-in accounts"
  on public.quota_policies for select
  using (auth.uid() is not null);