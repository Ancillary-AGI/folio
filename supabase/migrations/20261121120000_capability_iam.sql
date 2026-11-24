/*
  # Capability IAM

  Roles are product-defined; the matrix that says what each role may do is
  stored here and enforced by the database, not by the browser. Before this
  migration the console checked `role in ('owner', 'admin')` and every policy
  called `is_admin()`, so "administrator" was one undifferentiated grant and a
  capability the console decided not to show was still reachable through the
  API. This migration makes the matrix the single answer.

  ## `role_capabilities`
  One row per granted capability. It is seeded with the built-in matrix from
  `src/lib/admin/permissions.ts`:

    - owner: every capability;
    - admin: every capability except `operators.manage_owner`;
    - engineer and viewer: none — they are workbench roles, not operators.

  There is no client write policy. Changing the matrix is a product decision
  that ships in a migration, so an operator cannot revoke their own ability to
  administer the deployment from the console. The editable axis remains who
  holds which role (`profiles.role`), and every such change is audited.

  ## `has_capability()`
  Reads the caller's active profile, joins the matrix, and answers for one
  capability. Every governance policy and the profile guard now calls it.
  A caller without a JWT subject gets `false`; trusted bootstrap connections
  are handled by the guard itself, not by pretending they are an operator.

  ## Bootstrap fix
  The previous guard tested `current_user in ('postgres', 'service_role')`.
  That function is `security definer`, so `current_user` is the function owner
  (`postgres`) for *every* caller — the guard short-circuited itself and the
  role/status checks below it never ran. The trusted test is now
  `auth.uid() is null`: a SQL-editor bootstrap and a service-role connection
  have no JWT subject, while both API roles (`authenticated` and `anon`) do.
  `anon` has no update grant on `profiles`, so it cannot reach the trigger.

  ## Policies
  The existing `is_admin()` policies are replaced with the capability they
  actually mean. Public newsletter inserts and the public reads of FAQ and
  testimonials are untouched; the newsletter drain keeps using the service key
  and bypasses RLS as before.
*/

-- ── The matrix ──────────────────────────────────────────────────────────────
create table if not exists public.role_capabilities (
  role text not null check (role in ('owner', 'admin', 'engineer', 'viewer')),
  capability text not null check (capability in (
    'console.access',
    'accounts.read',
    'accounts.manage',
    'operators.manage_owner',
    'usage.read',
    'quotas.read',
    'quotas.manage',
    'audit.read',
    'audit.write',
    'content.manage',
    'newsletter.read',
    'newsletter.manage',
    'newsletter.send',
    'deployment.read',
    'data.export'
  )),
  created_at timestamptz not null default now(),
  primary key (role, capability)
);

alter table public.role_capabilities enable row level security;

-- The matrix is not secret: a signed-in account may read the rules it is held
-- to. Only a migration or a trusted connection may write it.
drop policy if exists "Signed-in accounts can read the capability matrix" on public.role_capabilities;
create policy "Signed-in accounts can read the capability matrix"
  on public.role_capabilities for select
  using (auth.uid() is not null);

grant select on public.role_capabilities to authenticated;

insert into public.role_capabilities (role, capability)
select 'owner', capability
from unnest(array[
  'console.access',
  'accounts.read',
  'accounts.manage',
  'operators.manage_owner',
  'usage.read',
  'quotas.read',
  'quotas.manage',
  'audit.read',
  'audit.write',
  'content.manage',
  'newsletter.read',
  'newsletter.manage',
  'newsletter.send',
  'deployment.read',
  'data.export'
]) as capability
on conflict (role, capability) do nothing;

insert into public.role_capabilities (role, capability)
select 'admin', capability
from unnest(array[
  'console.access',
  'accounts.read',
  'accounts.manage',
  'usage.read',
  'quotas.read',
  'quotas.manage',
  'audit.read',
  'audit.write',
  'content.manage',
  'newsletter.read',
  'newsletter.manage',
  'newsletter.send',
  'deployment.read',
  'data.export'
]) as capability
on conflict (role, capability) do nothing;

-- ── The question every policy asks ──────────────────────────────────────────
create or replace function public.has_capability(required text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.role_capabilities as grant_row
      on grant_row.role = profile.role
     and grant_row.capability = required
    where profile.id = auth.uid()
      and profile.status = 'active'
  );
$$;

revoke all on function public.has_capability(text) from public, anon;
grant execute on function public.has_capability(text) to authenticated;

-- ── Profile guard: capability-checked, bootstrap-safe ───────────────────────
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
   * Trusted connections have no JWT subject: the documented first-owner
   * bootstrap in the SQL editor, and a service-role connection. API callers
   * always carry one, and `anon` has no update grant on this table.
   */
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if not public.has_capability('accounts.manage') then
      raise exception 'Only accounts with the accounts.manage capability can change a role or status';
    end if;
    if new.id = auth.uid() and old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') then
      raise exception 'Administrators cannot remove their own administrator access';
    end if;
    if new.id = auth.uid() and new.status = 'suspended' then
      raise exception 'Administrators cannot suspend their own account';
    end if;
    if (old.role = 'owner' or new.role = 'owner')
       and not public.has_capability('operators.manage_owner') then
      raise exception 'Only an owner can grant, change or remove an owner account';
    end if;
  end if;
  return new;
end;
$$;

-- ── Governance policies ─────────────────────────────────────────────────────
drop policy if exists "Profiles are visible to their account or admins" on public.profiles;
create policy "Profiles are visible to their account or console readers"
  on public.profiles for select
  using (auth.uid() = id or public.has_capability('accounts.read'));

drop policy if exists "Accounts can update their own profile" on public.profiles;
create policy "Accounts can update their own profile"
  on public.profiles for update
  using (auth.uid() = id or public.has_capability('accounts.manage'))
  with check (auth.uid() = id or public.has_capability('accounts.manage'));

drop policy if exists "Usage is visible to its account or admins" on public.usage_events;
create policy "Usage is visible to its account or usage readers"
  on public.usage_events for select
  using (auth.uid() = user_id or public.has_capability('usage.read'));

drop policy if exists "Policies are editable by admins" on public.quota_policies;
create policy "Policies are insertable by quota managers"
  on public.quota_policies for insert
  with check (public.has_capability('quotas.manage'));

drop policy if exists "Policies are updatable by admins" on public.quota_policies;
create policy "Policies are updatable by quota managers"
  on public.quota_policies for update
  using (public.has_capability('quotas.manage'))
  with check (public.has_capability('quotas.manage'));

drop policy if exists "Operators can read the audit trail" on public.admin_audit;
create policy "Audit readers can read the audit trail"
  on public.admin_audit for select
  using (public.has_capability('audit.read'));

drop policy if exists "Operators can append their own audit rows" on public.admin_audit;
create policy "Audit writers can append their own audit rows"
  on public.admin_audit for insert
  with check (public.has_capability('audit.write') and actor_id = auth.uid());

-- Deployment totals are a `security definer` read of tables RLS hides; the
-- capability check is therefore the boundary, not decoration.
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
  if not public.has_capability('deployment.read') then
    raise exception 'Only accounts with the deployment.read capability can read deployment statistics';
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

-- ── Content ─────────────────────────────────────────────────────────────────
drop policy if exists "Operators can write the FAQ" on public.faq_entries;
create policy "Content managers can write the FAQ"
  on public.faq_entries for insert
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can edit the FAQ" on public.faq_entries;
create policy "Content managers can edit the FAQ"
  on public.faq_entries for update
  using (public.has_capability('content.manage'));

drop policy if exists "Operators can delete the FAQ" on public.faq_entries;
create policy "Content managers can delete the FAQ"
  on public.faq_entries for delete
  using (public.has_capability('content.manage'));

drop policy if exists "Operators can write testimonials" on public.testimonials;
create policy "Content managers can write testimonials"
  on public.testimonials for insert
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can edit testimonials" on public.testimonials;
create policy "Content managers can edit testimonials"
  on public.testimonials for update
  using (public.has_capability('content.manage'));

drop policy if exists "Operators can delete testimonials" on public.testimonials;
create policy "Content managers can delete testimonials"
  on public.testimonials for delete
  using (public.has_capability('content.manage'));

-- ── Newsletter ──────────────────────────────────────────────────────────────
-- Public subscribe stays exactly as it was: insert only, no read.
drop policy if exists "newsletter_subscribers_admin_read" on public.newsletter_subscribers;
create policy "newsletter_subscribers_operator_read"
  on public.newsletter_subscribers for select
  using (public.has_capability('newsletter.read'));

drop policy if exists "newsletter_subscribers_admin_update" on public.newsletter_subscribers;
create policy "newsletter_subscribers_operator_update"
  on public.newsletter_subscribers for update
  using (public.has_capability('newsletter.manage'))
  with check (public.has_capability('newsletter.manage'));

drop policy if exists "newsletter_subscribers_admin_delete" on public.newsletter_subscribers;
create policy "newsletter_subscribers_operator_delete"
  on public.newsletter_subscribers for delete
  using (public.has_capability('newsletter.manage'));

drop policy if exists "newsletter_campaigns_admin_all" on public.newsletter_campaigns;
create policy "newsletter_campaigns_operator_read"
  on public.newsletter_campaigns for select
  using (public.has_capability('newsletter.read'));

create policy "newsletter_campaigns_operator_insert"
  on public.newsletter_campaigns for insert
  with check (public.has_capability('newsletter.manage'));

create policy "newsletter_campaigns_operator_update"
  on public.newsletter_campaigns for update
  using (public.has_capability('newsletter.manage'))
  with check (public.has_capability('newsletter.manage'));

create policy "newsletter_campaigns_operator_delete"
  on public.newsletter_campaigns for delete
  using (public.has_capability('newsletter.manage'));

drop policy if exists "newsletter_deliveries_admin_all" on public.newsletter_deliveries;
create policy "newsletter_deliveries_operator_read"
  on public.newsletter_deliveries for select
  using (public.has_capability('newsletter.read'));

create policy "newsletter_deliveries_operator_write"
  on public.newsletter_deliveries for insert
  with check (public.has_capability('newsletter.manage'));

create policy "newsletter_deliveries_operator_update"
  on public.newsletter_deliveries for update
  using (public.has_capability('newsletter.manage'))
  with check (public.has_capability('newsletter.manage'));

create policy "newsletter_deliveries_operator_delete"
  on public.newsletter_deliveries for delete
  using (public.has_capability('newsletter.manage'));

/*
  `created_by` was declared `not null` with `on delete set null`, so deleting
  the operator account that drafted a campaign would fail instead of keeping
  the campaign with an unknown author. Dropping the constraint makes the
  `on delete set null` action possible, which is what the column comment
  promised.
*/
alter table public.newsletter_campaigns alter column created_by drop not null;
