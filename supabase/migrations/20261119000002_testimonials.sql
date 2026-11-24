/*
  # Testimonials

  Quotes from people who actually used the product, curated by operators.
  Empty on purpose — there is nothing honest to put in it until someone
  submits something real. Operators own it; nobody else writes it. Public
  visitors read it through the site's anonymous key.

  Same shape as the FAQ table: ordered by `position`, `published` hides a
  drafted quote without deleting it. Marketing copy, not signed contracts.
*/

create table if not exists public.testimonials (
  id bigint generated always as identity primary key,
  quote text not null,
  author text not null,
  role text not null default '',
  company text not null default '',
  position integer not null default 0,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists idx_testimonials_position on public.testimonials(position);

alter table public.testimonials enable row level security;

drop policy if exists "Testimonials are readable by anyone" on public.testimonials;
create policy "Testimonials are readable by anyone"
  on public.testimonials for select
  using (true);

drop policy if exists "Operators can write testimonials" on public.testimonials;
create policy "Operators can write testimonials"
  on public.testimonials for insert
  with check (public.is_admin());

drop policy if exists "Operators can edit testimonials" on public.testimonials;
create policy "Operators can edit testimonials"
  on public.testimonials for update
  using (public.is_admin());

drop policy if exists "Operators can delete testimonials" on public.testimonials;
create policy "Operators can delete testimonials"
  on public.testimonials for delete
  using (public.is_admin());

grant select on public.testimonials to authenticated, anon;
grant insert, update, delete on public.testimonials to authenticated;
grant usage, select on sequence public.testimonials_id_seq to authenticated;
