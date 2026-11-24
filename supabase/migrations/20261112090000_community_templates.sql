/*
  Community templates

  A place for people's projects, not ours. A designer publishes a project as a
  public template under an open licence; anyone else forks it into their own
  workspace with one click. The template payload is the same shape `ProjectBackup`
  already uses for local checkpoints (schematic canvas_data, pcbLayout, parts,
  mechanicalAssembly, domainDesigns and firmwareCode live in one jsonb blob), so
  the fork path is the same code that restores a checkpoint.

  Two rules keep this honest and lawful:

  1. Publishing is an explicit act with an explicit licence. The author grants
     CC-BY-4.0 or CC0; there is no "public by default" and there is no
     relicensing someone else's fork away from them.
  2. Cloning is free and unrestricted for public templates. `cloned_count` is
     kept for display only and incremented by a security-definer RPC so a fork
     cannot rewrite anyone's row.
*/

create table if not exists public.community_projects (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Anonymous',
  name text not null,
  description text not null default '',
  discipline text not null default 'circuits',
  license text not null,
  workspace_mode text not null default 'schematic',
  canvas_data jsonb not null default '{}'::jsonb,
  cloned_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.community_projects
  add constraint community_projects_license_check
  check (license in ('cc-by-4.0', 'cc0-1.0'));

alter table public.community_projects
  add constraint community_projects_discipline_check
  check (discipline in ('circuits', 'control', 'mechanical', 'robotics', 'rf', 'software', 'other'));

alter table public.community_projects
  add constraint community_projects_name_len check (char_length(name) between 1 and 120);
alter table public.community_projects
  add constraint community_projects_desc_len check (char_length(description) <= 600);

create index if not exists community_projects_created_idx
  on public.community_projects (created_at desc);
create index if not exists community_projects_author_idx
  on public.community_projects (author_id);
create index if not exists community_projects_discipline_idx
  on public.community_projects (discipline);

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.community_projects enable row level security;

-- Anyone may read public templates, signed-in or not. The payload is design
-- data the author released under an open licence; nothing here is secret.
create policy "community_projects_public_read"
  on public.community_projects for select
  using (true);

-- Publishing is an explicit act: the author is the only one allowed to insert,
-- and only as themselves.
create policy "community_projects_author_insert"
  on public.community_projects for insert
  with check (auth.uid() = author_id);

create policy "community_projects_author_update"
  on public.community_projects for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create policy "community_projects_author_delete"
  on public.community_projects for delete
  using (auth.uid() = author_id);

-- ── Fork counter ────────────────────────────────────────────────────────────
-- A fork must be able to bump the counter without being able to write any
-- other column, so the increment lives in a security-definer function that
-- touches exactly one column on one row.
create or replace function public.bump_community_fork_count(template_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.community_projects
     set cloned_count = cloned_count + 1
   where id = template_id;
$$;

grant execute on function public.bump_community_fork_count(uuid) to authenticated;
grant execute on function public.bump_community_fork_count(uuid) to anon;
