-- Splits the free-text `location` into a real postal address so the app can
-- offer players a Directions link straight into Maps.

alter table events
  add column if not exists address_line text not null default '',
  add column if not exists city         text not null default '',
  add column if not exists state        text not null default '',
  add column if not exists postal_code  text not null default '';

-- Carry over whatever was in `location`. It was typically "City, State", so
-- split on the last comma; anything else lands in city for an admin to tidy.
--
-- Only projects created before the address columns existed have a `location` to
-- carry over. A database initialised from the current 0001_init.sql never had
-- one, and naming the column directly would fail to parse there, so the backfill
-- is guarded and run as dynamic SQL.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'location'
  ) then
    execute $backfill$
      update events
         set city  = trim(split_part(location, ',', 1)),
             state = upper(left(trim(nullif(split_part(location, ',', 2), '')), 2))
       where location is not null
         and location <> ''
         and city = ''
    $backfill$;
  end if;
end $$;

alter table events drop column if exists location;
