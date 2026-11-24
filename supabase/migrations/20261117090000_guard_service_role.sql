/*
  # Guard service and superuser writes

  `guard_profile_changes()` refuses any role/status change that is not made by
  an active owner/admin. It reads `auth.uid()`, which is NULL for a service
  connection — so the documented first-owner bootstrap (`update public.profiles
  set role = 'owner' where email = 'you@example.com'`) is refused by the very
  guard that is supposed to stop privilege escalation. No deployment could
  ever promote its first operator; the migration was never executed against a
  live database.

  The carve-out mirrors how Supabase itself behaves: the `service_role`
  (service key) bypasses RLS, and hosted SQL editors run as superuser. Both
  are trusted to manage the directory. API roles (`authenticated`, `anon`)
  are never in this list, so the guard keeps every property it was designed
  for: no API caller can change a role or status, self-demotion and owner
  grants stay refused.
*/

create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    if not public.is_admin() then
      raise exception 'Only administrators can change a role or status';
    end if;
    if new.id = auth.uid() and old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') then
      raise exception 'Administrators cannot remove their own administrator access';
    end if;
    if old.role = 'owner' and not public.is_owner() then
      raise exception 'Only an owner can change an owner account';
    end if;
    if new.role = 'owner' and not public.is_owner() then
      raise exception 'Only an owner can grant the owner role';
    end if;
  end if;
  return new;
end;
$$;
