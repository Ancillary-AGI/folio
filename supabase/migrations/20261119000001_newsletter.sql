/*
  Newsletter — subscriber list and campaigns

  One table for people who asked to hear from Folio (`newsletter_subscribers`),
  two for the campaign machinery (`newsletter_campaigns` and
  `newsletter_deliveries`).

  Rules that keep this lawful and honest:

  1. Subscribing is self-service — anyone with the public page may insert an
     email address, nothing more. They cannot read anyone else's row (RLS
     hides the table) and may remove themselves by token, no account needed.
  2. Sending is an operator act: campaigns and their deliveries are readable
     and writable only by admins (`public.is_admin()`), exactly like every
     other governance table.
  3. Unsubscribed addresses are never deleted — the row is kept with
     `unsubscribed_at` set, so a mail client can prove the list is consistent
     and a re-subscribe is a deliberate act.
  4. `newsletter_deliveries` records per-recipient outcomes, so a campaign
     can be paused, crash halfway through a list of 40,000 addresses and
     resume without double-sending or guessing.

  The send itself runs in the backend process; SMTP credentials come from the
  environment and are never stored in the database or shipped to the client.
*/

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  display_name text not null default '',
  source text not null default 'site',
  unsubscribe_token uuid not null default gen_random_uuid(),
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  last_sent_at timestamptz
);

create index if not exists newsletter_subscribers_active_idx
  on public.newsletter_subscribers (subscribed_at desc)
  where unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;

/* Anon can subscribe and only subscribe. No SELECT policy means nobody on
 * the page can read addresses they do not own. */
create policy "newsletter_subscribers_anon_insert"
  on public.newsletter_subscribers for insert
  with check (true);
/* Admins read the list, update and delete through the audited admin
 * service only. */
create policy "newsletter_subscribers_admin_read"
  on public.newsletter_subscribers for select
  using (public.is_admin());
create policy "newsletter_subscribers_admin_update"
  on public.newsletter_subscribers for update
  using (public.is_admin())
  with check (public.is_admin());
create policy "newsletter_subscribers_admin_delete"
  on public.newsletter_subscribers for delete
  using (public.is_admin());

create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  recipients int not null default 0,
  delivered int not null default 0,
  failed int not null default 0,
  last_error text
);

create index if not exists newsletter_campaigns_created_idx
  on public.newsletter_campaigns (created_at desc);

alter table public.newsletter_campaigns enable row level security;

create policy "newsletter_campaigns_admin_all"
  on public.newsletter_campaigns for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  subscriber_id uuid not null references public.newsletter_subscribers(id),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  unique (campaign_id, subscriber_id)
);

create index if not exists newsletter_deliveries_campaign_status_idx
  on public.newsletter_deliveries (campaign_id, status);

alter table public.newsletter_deliveries enable row level security;

create policy "newsletter_deliveries_admin_all"
  on public.newsletter_deliveries for all
  using (public.is_admin())
  with check (public.is_admin());

/* Cap the mail rate: 200 ms between chunks and batches of 20 keep any SMTP
 * server responsive; chunk size lives in the sender code so it can be tuned
 * without a migration. */
