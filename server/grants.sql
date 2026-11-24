-- Reapplied after every migration run: keeps the API roles' table privileges
-- in line with hosted Supabase (broad grants at the database level; RLS
-- enforces row access). Idempotent.
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The public may subscribe to the newsletter and nothing else. One row, one
-- operation; RLS enforces that nobody can read or remove anyone else's row.
grant insert on public.newsletter_subscribers to anon;
