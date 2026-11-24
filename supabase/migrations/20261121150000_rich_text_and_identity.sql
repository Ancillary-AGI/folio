/*
  # Rich-text legal pages and capability-gated site identity

  This migration is the bridge for deployments that already applied the first
  legal-page and site-settings migrations.

  ## Legal pages

  The first cut stored `sections` as `{ heading, paragraphs, links? }`. The
  editor is now rich text, and the stored shape is `{ heading, body }`, where
  `body` is a block document (paragraphs, headings, lists, quotes and inline
  runs). The conversion below is lossless for the old copy:

    - each paragraph becomes a paragraph block;
    - each link list becomes a final paragraph of linked runs.

  It is idempotent: a section that already has `body` is left alone. The
  policies are rewritten to `content.manage`, which is the capability the
  console's legal panel checks.

  ## Site identity

  `site_url`, `tagline` and `description` are new identity fields used by
  metadata, the sitemap, robots.txt and the web manifest. They are added with
  empty defaults; an untouched row receives the shipped Folio values, while a
  configured row keeps everything the operator already set.

  Writes are capability-gated with the same `content.manage` grant. Reads stay
  anonymous: this is the footer, by design.
*/

-- ---------------------------------------------------------------------------
-- Legal pages: old sections -> rich-text body
-- ---------------------------------------------------------------------------

do $$
declare
  page_row record;
  section jsonb;
  converted jsonb;
  body jsonb;
  paragraphs jsonb;
  links jsonb;
  link jsonb;
  runs jsonb;
  i integer;
begin
  for page_row in select slug, sections from public.legal_pages loop
    if page_row.sections is null or jsonb_typeof(page_row.sections) <> 'array' then
      continue;
    end if;
    converted := '[]'::jsonb;
    for section in select value from jsonb_array_elements(page_row.sections) loop
      if section ? 'body' then
        converted := converted || jsonb_build_array(section);
        continue;
      end if;

      body := '[]'::jsonb;
      paragraphs := section->'paragraphs';
      if paragraphs is not null and jsonb_typeof(paragraphs) = 'array' then
        for i in 0..jsonb_array_length(paragraphs) - 1 loop
          if length(trim(coalesce(paragraphs->>i, ''))) > 0 then
            body := body || jsonb_build_array(jsonb_build_object(
              'type', 'paragraph',
              'runs', jsonb_build_array(jsonb_build_object('text', paragraphs->>i))
            ));
          end if;
        end loop;
      end if;

      links := section->'links';
      if links is not null and jsonb_typeof(links) = 'array' and jsonb_array_length(links) > 0 then
        runs := '[]'::jsonb;
        for i in 0..jsonb_array_length(links) - 1 loop
          link := links->i;
          if (link->>'href') ~* '^(https?://|mailto:)' and length(trim(coalesce(link->>'label', ''))) > 0 then
            if jsonb_array_length(runs) > 0 then
              runs := runs || jsonb_build_array(jsonb_build_object('text', ' · '));
            end if;
            runs := runs || jsonb_build_array(jsonb_build_object(
              'text', link->>'label',
              'href', link->>'href'
            ));
          end if;
        end loop;
        if jsonb_array_length(runs) > 0 then
          body := body || jsonb_build_array(jsonb_build_object('type', 'paragraph', 'runs', runs));
        end if;
      end if;

      if jsonb_array_length(body) > 0 then
        converted := converted || jsonb_build_array(jsonb_build_object(
          'heading', section->>'heading',
          'body', body
        ));
      end if;
    end loop;
    update public.legal_pages set sections = converted where slug = page_row.slug;
  end loop;
end $$;

drop policy if exists "Operators can insert a legal page" on public.legal_pages;
create policy "Operators can insert a legal page"
  on public.legal_pages for insert
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can edit a legal page" on public.legal_pages;
create policy "Operators can edit a legal page"
  on public.legal_pages for update
  using (public.has_capability('content.manage'))
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can delete a legal page" on public.legal_pages;
create policy "Operators can delete a legal page"
  on public.legal_pages for delete
  using (public.has_capability('content.manage'));

comment on table public.legal_pages is
  'Operator-editable rich-text copy for the public about, terms, privacy and security pages.';

-- ---------------------------------------------------------------------------
-- Site identity: canonical origin, tagline and default description
-- ---------------------------------------------------------------------------

alter table public.site_settings add column if not exists tagline text not null default '';
alter table public.site_settings add column if not exists description text not null default '';
alter table public.site_settings add column if not exists site_url text not null default '';

-- These columns did not exist before this migration, so an empty value cannot
-- be a deliberate operator choice yet. Fill the shipped defaults once; later
-- clears are respected.
update public.site_settings
set
  tagline = 'Engineering workbench.',
  description = 'Folio is your engineer in the loop — across domains, verified end to end. Free on your machine.',
  site_url = 'https://folio.dev',
  updated_at = now()
where id
  and tagline = ''
  and description = ''
  and site_url = '';

drop policy if exists "Operators can edit site settings" on public.site_settings;
create policy "Operators can edit site settings"
  on public.site_settings for update
  using (public.has_capability('content.manage'))
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can insert site settings" on public.site_settings;
create policy "Operators can insert site settings"
  on public.site_settings for insert
  with check (public.has_capability('content.manage'));

comment on table public.site_settings is
  'One row of public-shell identity: product name, company, tagline, description, canonical origin, contact and source links.';
