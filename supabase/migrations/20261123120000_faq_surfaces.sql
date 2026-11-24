/*
  # FAQ surfaces

  The first FAQ table served one list on the home page. The pricing page has
  its own questions, and they are operator-owned copy too, so a row now names
  the surface it belongs to. The default keeps every existing row on the home
  page; the pricing list is seeded only when that surface is empty.

  `position` still orders entries within a surface. Ties break on id. RLS is
  unchanged: anyone may read, only an operator with `content.manage` may write
  (the existing policies are expressed through `public.is_admin()`, which the
  capability migration keeps aligned for content roles).
*/

alter table public.faq_entries
  add column if not exists surface text not null default 'home';

alter table public.faq_entries
  drop constraint if exists faq_entries_surface_check;

alter table public.faq_entries
  add constraint faq_entries_surface_check
  check (surface in ('home', 'pricing'));

create index if not exists idx_faq_entries_surface_position
  on public.faq_entries(surface, position);

do $$
begin
  if not exists (select 1 from public.faq_entries where surface = 'pricing') then
    insert into public.faq_entries (surface, question, answer, position) values
      ('pricing',
       'Is Free really free and unlimited?',
       'Yes. The standalone build runs on your machine with no account, no upload, no telemetry. Your designs never leave your disk unless you publish or export them.',
       0),
      ('pricing',
       'When does billing start?',
       'It has not shipped. Pro and Team will charge only when it does - never retroactively - and Free stays free and unlimited.',
       1),
      ('pricing',
       'What counts as a user?',
       'A person with their own identity. On Team, an administrator assigns engineer, viewer or owner roles per person; quotas are enforced by the database, not by the UI.',
       2),
      ('pricing',
       'Can I buy Pro today?',
       'No. There is no checkout yet, and this page does not fake one. Leave an address via the Pro or Team link and you will be told when billing opens.',
       3),
      ('pricing',
       'Do I keep my designs if I cancel Pro?',
       'Always. Exports - STEP, Gerber, BOM, JSON, fab package - are free on every tier, and everything you made stays on your machine where Free still works.',
       4),
      ('pricing',
       'What about community designs?',
       'Open to everyone, free to open and adopt. In Free you share them as files; in Pro you can publish them for the whole community.',
       5),
      ('pricing',
       'What does the admin console do?',
       'It manages the deployment: members, roles, quota policies, usage ledger and the audit trail. It is not the CAD, and a designer never sees it.',
       6),
      ('pricing',
       'Can we run Folio in our VPC?',
       'That is Enterprise: private deployment, SSO, data residency, retention controls, and a named engineer. Reach the operator from the footer.',
       7);
  end if;
end $$;
