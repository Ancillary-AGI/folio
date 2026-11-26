/*
  # Operator-owned landing copy

  The public landing page's headline, introduction and calls to action are
  operator-owned copy, not build-time constants — the same rule the legal pages
  follow. They live here so an operator can change them without a redeploy.

  Reading is free for anyone: this is the front door, by design. Writing is
  restricted to operators through `public.is_admin()`.

  Seeding is `on conflict do nothing` on the single row, so a re-applied
  migration never overwrites an operator's edit. The seeded values are the copy
  that shipped, so a fresh deployment renders exactly what the repository shows.
*/

alter table public.site_settings
  add column if not exists hero_eyebrow text not null default '',
  add column if not exists hero_heading text not null default '',
  add column if not exists hero_lede text not null default '',
  add column if not exists hero_cta_label text not null default '',
  add column if not exists hero_cta_href text not null default '';

-- Fill the new columns on the single row, but only where they are still blank,
-- so an operator's edit survives a re-applied migration.
update public.site_settings
   set hero_eyebrow = 'YOUR ENGINEER IN THE LOOP',
       hero_heading = E'One brief.\nOne verified board.',
       hero_lede = 'Describe what you''re building. Folio drafts the schematic across every domain, runs the solver after every edit, routes it on the real grid, clears the DRC gate, and hands you a fab-ready package.',
       hero_cta_label = 'Sign up to design',
       hero_cta_href = '/sign-in?mode=signup'
 where id = true
   and hero_eyebrow = ''
   and hero_heading = '';