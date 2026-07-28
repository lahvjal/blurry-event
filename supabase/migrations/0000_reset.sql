-- Clears the previous multi-event schema so the single-event model can be
-- applied cleanly. Verified empty (0 rows in every table) before writing this.
--
-- Drops every table, enum, and the auth signup trigger in the public schema.
-- Extensions are left in place.

do $$
declare
  r record;
begin
  -- Tables (cascade takes their policies, indexes, and FKs with them)
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- Views left behind by the old model
  for r in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;

  -- Enums
  for r in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;

-- Signup hook from any earlier schema
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.current_participant_id() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.can_write_round(uuid) cascade;
drop function if exists public.lookup_invite(text) cascade;
