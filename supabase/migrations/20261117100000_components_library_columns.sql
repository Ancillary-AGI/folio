/*
  # Component library columns

  `src/lib/componentLibrary.ts` seeds the standard library from catalog
  entries that carry manufacturer metadata — `description`, `manufacturer`,
  `part_number`, `datasheet_url`, `tags` — and the insert is a single call
  whose `?columns=` is the union of keys across every row, so the whole
  seed fails with "column does not exist" against the original schema and
  the library is silently empty on every deployment. This was never run
  against a live database until the local backend existed.

  These columns belong on the table: the catalog is the component library
  for real BOM work, where part numbers and datasheets are the difference
  between a design you can source and one you can't.

  Additive only: nullable text columns and a defaulted jsonb tag array.
  No data is rewritten, no policy changes.
*/
alter table public.components add column if not exists description text;
alter table public.components add column if not exists manufacturer text;
alter table public.components add column if not exists part_number text;
alter table public.components add column if not exists datasheet_url text;
alter table public.components add column if not exists tags jsonb not null default '[]'::jsonb;
