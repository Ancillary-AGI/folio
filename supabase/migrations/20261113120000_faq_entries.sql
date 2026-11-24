/*
  # FAQ entries

  A single-column, ordered list of question/answer pairs for the public FAQ.
  Operators own it; nobody else writes it. Public visitors read it through
  the site's anonymous key.

  Reading is free for anyone, but reading is NOT scoped by owner: the FAQ is
  marketing copy, by design.

  `position` is an integer sorting key the operator assigns. Ties break on
  `id`; the admin console shows them in that order. `published` hides a
  drafted row without deleting it.
*/

create table if not exists public.faq_entries (
  id bigint generated always as identity primary key,
  question text not null,
  answer text not null,
  position integer not null default 0,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists idx_faq_entries_position on public.faq_entries(position);

alter table public.faq_entries enable row level security;

drop policy if exists "FAQ is readable by anyone" on public.faq_entries;
create policy "FAQ is readable by anyone"
  on public.faq_entries for select
  using (true);

drop policy if exists "Operators can write the FAQ" on public.faq_entries;
create policy "Operators can write the FAQ"
  on public.faq_entries for insert
  with check (public.is_admin());

drop policy if exists "Operators can edit the FAQ" on public.faq_entries;
create policy "Operators can edit the FAQ"
  on public.faq_entries for update
  using (public.is_admin());

drop policy if exists "Operators can delete the FAQ" on public.faq_entries;
create policy "Operators can delete the FAQ"
  on public.faq_entries for delete
  using (public.is_admin());

grant select on public.faq_entries to authenticated, anon;
grant insert, update, delete on public.faq_entries to authenticated;
grant usage, select on sequence public.faq_entries_id_seq to authenticated;

-- Seed only when the table is empty — no duplicate rows on re-apply.
do $$
begin
  if not exists (select 1 from public.faq_entries limit 1) then
    insert into public.faq_entries (question, answer, position) values
      ('Is the simulator a real SPICE, or a visual approximation?',
       'A real SPICE. MNA with Newton–Raphson companion stamps, Gummel–Poon BJTs with Early voltages and junction capacitances, and level-1 Shichman–Hodges MOSFETs with body effect, channel-length modulation and gate capacitances. JFET level-1, op-amp companions and vendor model cards are all parsed and evaluated; the vendor library ships the actual IRF540N, 2N7000 and 2N3055 parameters.',
       0),
      ('Is the router really routing, or is it coloured lines?',
       'It routes. A rip-up-and-retry A* grid router runs on the real board geometry against the nets your schematic declared. Vias go inside declared via-span rules, skew is measured for the DDR and byte-lane groups it handles, and what it cannot route is reported by net and layer — not drawn anyway. It is not an auto-router like Allegro; it routes typical boards and names the ones it cannot.',
       1),
      ('What won’t the agent do?',
       'Invent component values, claim the simulation passed when it has not, add nets you did not agree to, or run signal integrity or thermal analysis — neither exists in Folio, and neither will be faked. When it cannot do the job, it says so and stops. It places parts, wires traces, annotates nets, runs the solver, reads ERC, opens the DRC and writes the fab package — the same tools you open by hand.',
       2),
      ('Is the local build really free, or will it start charging?',
       'Free indefinitely. The standalone build has no account, no upload, no telemetry — it cannot accept payment and will not start tomorrow. Pro and Team add the cloud doors only: hosted sync, the publish button, the admin console. Local stays unlimited and stays free.',
       3),
      ('Where is my design right now?',
       'On your disk. Projects, checkpoints, VCS branches, exports and simulations all live in this browser''s local storage on this machine. Exports are plain files — Gerber, Excellon, CSV, STEP — never a proprietary blob a vendor can hold hostage. You can encrypt any export with a passphrase before moving it between computers.',
       4),
      ('What does Folio ship to a fab house?',
       'Gerber RS-274X per film, Excellon with blind/buried span support, centroid CSV for SMT assembly, BOM with lifecycle status, and a DRC printout. The Gerbers are CRC-verified. If a fab house won''t accept the files, you will find out before you spend money — from the DRC list.',
       5),
      ('What does it cost today?',
       'Nothing. Pro at $19 and Team at $49 per user per month are announced pricing for when billing exists — not a charge that starts today. Enterprise is a signed conversation: private deployment, SSO, dedicated seats, SLA. There is no license server, no phone-home check, and no expiry date on the offline build.',
       6),
      ('How is Folio tested?',
       'The gate is npm run verify and it fails the build. It covers type-check, strict lint with zero allowed warnings, accessibility checks (icon-button names, the full contract of 460+ files), and thousands of assertions across hundreds of test files — solver accuracy pinned against closed-form references, router steered through cases known not to fit, DRC violations firing at the exact geometry that causes them, CRC32 on every byte of a fab package.',
       7);
  end if;
end $$;

