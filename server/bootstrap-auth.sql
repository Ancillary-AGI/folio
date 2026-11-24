-- Folio local backend — auth schema bootstrap.
--
-- The hosted Supabase project ships an `auth` schema (users, refresh tokens,
-- `auth.uid()`) and three roles (`anon`, `authenticated`, `service_role`)
-- that the migrations and the RLS policies depend on. A plain PostgreSQL
-- install has none of that, so this file creates exactly that much — no
-- more. Everything else comes from the repo's own migrations, applied by
-- `npm run backend:db` afterwards.
--
-- Idempotent: safe to run on every setup.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator noinherit login password 'folio-local-authenticator';
       exception when duplicate_object then null; end $$;

grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;

create schema if not exists auth;

-- The user directory the governance migrations trigger on. Passwords are
-- scrypt hashes written by server/folio-backend.mjs; nothing else reads
-- this column.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmation_token text not null default '',
  recovery_token text not null default '',
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table if not exists auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_refresh_tokens_user on auth.refresh_tokens(user_id);

-- PostgREST exposes the JWT as `request.jwt.claims` (a JSON string). The RLS
-- policies call `auth.uid()`, so the helper reads the same setting.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select case
    when coalesce(current_setting('request.jwt.claims', true), '') = '' then null
    else nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  end
$$;

-- Schema usage for the API roles; table-level grants come from the migrations.
grant usage on schema public, auth to anon, authenticated, service_role;

-- Hosted Supabase grants broad table privileges to the API roles at the
-- database level and relies on RLS for row access. Mirror that here,
-- otherwise the API roles can't even reach a table before RLS applies.
-- This must run BEFORE the migrations so the tables inherit it; it is also
-- reapplied after the migrations for anything created later.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
