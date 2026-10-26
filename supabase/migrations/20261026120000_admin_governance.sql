/*
  # Administration and governance

  Adds the cloud-side directory, usage ledger and quota policies behind the
  in-app administration console (/admin). Local mode does not need this schema:
  it has exactly one owner and a device-local ledger.

  ## Tables

  ### `profiles`
  One row per auth account: email, display name, governance role and status.
  Roles: owner, admin, engineer, viewer. New sign-ups start as `viewer`; an
  existing owner promotes them (see the bootstrap note at the end).

  ### `usage_events`
  Append-only, per-account action ledger written by the client recorder and by
  the project trigger. Kinds match `src/lib/admin/usageLedger.ts`.

  ### `quota_policies`
  One row per role. `NULL` means unlimited. Owner and administrator are seeded
  unlimited; the client refuses to edit them.

  ## Enforcement

  - `enforce_project_quota()` blocks a project insert over the role's limit.
  - `enforce_usage_quota()` blocks export/simulation events over the daily
    limit. Storage is not enforced server-side (the browser reports it).
  - `guard_profile_changes()` prevents non-admins from changing roles/status,
    prevents self-demotion and reserves owner changes to owners.

  ## Bootstrap

  This migration deliberately does not guess who the owner is. After the first
  account signs up, promote it once with the service role:

      update public.profiles set role = 'owner' where email = 'you@example.com';

  Invitations are not implemented here: they require the Supabase admin API and
  a service-role key, which must never ship in the browser.
*/

-- ── Profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'engineer', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);

-- Existing accounts need a directory row before they can be administered.
insert into public.profiles (id, email, display_name, role, status)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(users.raw_user_meta_data ->> 'full_name', split_part(coalesce(users.email, ''), '@', 1)),
  'viewer',
  'active'
from auth.users as users
on conflict (id) do nothing;

-- ── Usage events ────────────────────────────────────────────────────────────
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'workspace.open', 'demo.load', 'project.create', 'project.open', 'vcs.commit',
    'export.run', 'simulation.run', 'agent.run', 'onboarding.complete', 'admin.open'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user_time on public.usage_events(user_id, created_at desc);
create index if not exists idx_usage_events_kind_time on public.usage_events(kind, created_at desc);

-- ── Quota policies ──────────────────────────────────────────────────────────
create table if not exists public.quota_policies (
  role text primary key check (role in ('owner', 'admin', 'engineer', 'viewer')),
  max_projects integer check (max_projects is null or max_projects >= 0),
  max_exports_per_day integer check (max_exports_per_day is null or max_exports_per_day >= 0),
  max_simulations_per_day integer check (max_simulations_per_day is null or max_simulations_per_day >= 0),
  max_storage_mb numeric check (max_storage_mb is null or max_storage_mb >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.quota_policies (role, max_projects, max_exports_per_day, max_simulations_per_day, max_storage_mb)
values
  ('owner', null, null, null, null),
  ('admin', null, null, null, null),
  ('engineer', 100, 200, 1000, 2048),
  ('viewer', 3, 20, 50, 100)
on conflict (role) do nothing;

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role = 'owner'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_quota_policies_updated_at on public.quota_policies;
create trigger trg_quota_policies_updated_at
  before update on public.quota_policies
  for each row execute function public.touch_updated_at();

-- ── New accounts get a profile ──────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'viewer',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Role/status guard ───────────────────────────────────────────────────────
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status then
    if not public.is_admin() then
      raise exception 'Only administrators can change a role or status';
    end if;
    if new.id = auth.uid() and old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') then
      raise exception 'Administrators cannot remove their own administrator access';
    end if;
    if old.role = 'owner' and not public.is_owner() then
      raise exception 'Only an owner can change an owner account';
    end if;
    if new.role = 'owner' and not public.is_owner() then
      raise exception 'Only an owner can grant the owner role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- ── Quota enforcement ───────────────────────────────────────────────────────
create or replace function public.enforce_project_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_limit integer;
  v_used integer;
begin
  select role into v_role
  from public.profiles
  where id = new.user_id and status = 'active';

  if v_role is null then
    raise exception 'No active governance profile exists for this account';
  end if;

  select max_projects into v_limit from public.quota_policies where role = v_role;
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_used from public.projects where user_id = new.user_id;
  if v_used >= v_limit then
    raise exception 'Project quota exhausted for role % (% of %)', v_role, v_used, v_limit;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_quota on public.projects;
create trigger trg_projects_quota
  before insert on public.projects
  for each row execute function public.enforce_project_quota();

create or replace function public.enforce_usage_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_limit integer;
  v_used integer;
  v_label text;
begin
  if new.kind not in ('export.run', 'simulation.run') then
    return new;
  end if;

  select role into v_role
  from public.profiles
  where id = new.user_id and status = 'active';

  if v_role is null then
    raise exception 'No active governance profile exists for this account';
  end if;

  if new.kind = 'export.run' then
    select max_exports_per_day into v_limit from public.quota_policies where role = v_role;
    v_label := 'export';
  else
    select max_simulations_per_day into v_limit from public.quota_policies where role = v_role;
    v_label := 'simulation';
  end if;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_used
  from public.usage_events
  where user_id = new.user_id
    and kind = new.kind
    and created_at >= date_trunc('day', now());

  if v_used >= v_limit then
    raise exception 'Daily % quota exhausted for role % (% of %)', v_label, v_role, v_used, v_limit;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usage_events_quota on public.usage_events;
create trigger trg_usage_events_quota
  before insert on public.usage_events
  for each row execute function public.enforce_usage_quota();

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;
alter table public.quota_policies enable row level security;

drop policy if exists "Profiles are visible to their account or admins" on public.profiles;
create policy "Profiles are visible to their account or admins"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "Accounts can update their own profile" on public.profiles;
create policy "Accounts can update their own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists "Usage is visible to its account or admins" on public.usage_events;
create policy "Usage is visible to its account or admins"
  on public.usage_events for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Accounts can append their own usage" on public.usage_events;
create policy "Accounts can append their own usage"
  on public.usage_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "Policies are visible to admins" on public.quota_policies;
create policy "Policies are visible to admins"
  on public.quota_policies for select
  using (public.is_admin());

drop policy if exists "Policies are editable by admins" on public.quota_policies;
create policy "Policies are editable by admins"
  on public.quota_policies for insert
  with check (public.is_admin());

drop policy if exists "Policies are updatable by admins" on public.quota_policies;
create policy "Policies are updatable by admins"
  on public.quota_policies for update
  using (public.is_admin())
  with check (public.is_admin());

-- The ledger is append-only for clients: no update or delete policy.

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select, update on public.profiles to authenticated;
grant select, insert on public.usage_events to authenticated;
grant select, insert, update on public.quota_policies to authenticated;
grant usage, select on sequence public.usage_events_id_seq to authenticated;
