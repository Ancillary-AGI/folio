/*
  # Site identity

  The public shell's chrome needs a handful of values that are not page copy:
  the product name, the company behind it, a contact address, and the source
  and vulnerability-policy links. Those are deployment data — an operator who
  self-hosts is not X Industries, and a fork is not Folio — so they live here
  rather than in the bundle.

  There is exactly one row. Reading is free for anyone: this is the footer, by
  design, and is not scoped by owner. Writing is restricted to operators
  holding the `content.manage` capability, the same gate the legal pages use.

  An empty `text` column means "not set": the shell omits that element rather
  than showing a placeholder. Seeding fills every column, so a fresh
  deployment renders a complete footer and a complete set of page metadata.

  `site_url` is the canonical origin used by metadata, the sitemap and
  robots.txt. `tagline` and `description` are identity copy, not page copy: the
  footer line and the default search/social description.
*/

create table if not exists public.site_settings (
  id boolean primary key default true,
  product_name text not null default '',
  parent_company text not null default '',
  tagline text not null default '',
  description text not null default '',
  contact_email text not null default '',
  site_url text not null default '',
  github_url text not null default '',
  codeberg_url text not null default '',
  security_policy_url text not null default '',
  updated_at timestamptz not null default now(),
  constraint site_settings_single_row check (id)
);

comment on table public.site_settings is
  'One row of public-shell identity: product name, company, tagline, description, canonical origin, contact and source links.';

alter table public.site_settings enable row level security;

drop policy if exists "Site settings are readable by anyone" on public.site_settings;
create policy "Site settings are readable by anyone"
  on public.site_settings for select
  using (true);

drop policy if exists "Operators can edit site settings" on public.site_settings;
create policy "Operators can edit site settings"
  on public.site_settings for update
  using (public.has_capability('content.manage'))
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can insert site settings" on public.site_settings;
create policy "Operators can insert site settings"
  on public.site_settings for insert
  with check (public.has_capability('content.manage'));

grant select on public.site_settings to authenticated, anon;
grant insert, update on public.site_settings to authenticated;

-- Seed only when the table is empty, so a re-applied migration never
-- overwrites an operator's edits.
insert into public.site_settings
  (id, product_name, parent_company, tagline, description, contact_email, site_url,
   github_url, codeberg_url, security_policy_url)
select
  true,
  'Folio',
  'X Industries',
  'Engineering workbench.',
  'Folio is your engineer in the loop — across domains, verified end to end. Free on your machine.',
  'founder@folio.dev',
  'https://folio.dev',
  'https://github.com/Ancillary-AGI/folio',
  'https://codeberg.org/X-Industries',
  'https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md'
where not exists (select 1 from public.site_settings);