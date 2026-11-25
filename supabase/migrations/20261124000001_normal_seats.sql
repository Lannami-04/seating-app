-- =====================================================================
-- 9 · Exact chair counts for VIP / big group tables
--
-- VIP and big group tables can now have an exact number of chairs, odd numbers too (a VIP table of 5,
-- or a big group of 8 + 8 tables cut down to 8 + 7 for a party of 15). tables.seats already holds the
-- number of chairs, and the chairs are made from it, so nothing about that changes.
--
-- New: tables.normal_seats remembers the table's usual size while it has an exact count (8 for the table
-- cut down to 7), so "Restore normal size" can put the chairs back, and the floor still draws the table
-- at its usual size. Null = the table has its usual seats. Only kept on VIP / big group tables.
--
--   1. tables.normal_seats (empty for every existing table: nothing changes for them)
--   2. save_layout: same as before (file 7), plus normal_seats
--
-- Paste into the Supabase SQL Editor after the earlier files.
-- =====================================================================

alter table public.tables
  add column if not exists normal_seats int check (normal_seats between 1 and 60);

-- save_layout: same as before, plus normal_seats.
create or replace function public.save_layout(p_restaurant uuid, p_layout jsonb)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id  uuid := (p_layout->>'id')::uuid;
  v_now timestamptz := now();
begin
  if not private.is_staff(p_restaurant) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  -- Seating changes on this layout wait until the save is finished.
  perform 1 from public.events e where e.layout_id = v_id and e.ended_at is null for update;

  insert into public.layouts (id, restaurant_id, name, width, height, created_at, updated_at)
  values (
    v_id, p_restaurant, left(trim(p_layout->>'name'), 100),
    (p_layout->>'width')::real, (p_layout->>'height')::real,
    coalesce(to_timestamp((p_layout->>'createdAt')::double precision / 1000), v_now), v_now
  )
  on conflict (id) do update
    set name = excluded.name, width = excluded.width, height = excluded.height, updated_at = v_now;

  -- Sections
  delete from public.sections s
  where s.layout_id = v_id
    and s.id not in (select j.v->>'id' from jsonb_array_elements(coalesce(p_layout->'sections', '[]'::jsonb)) as j(v));
  insert into public.sections (layout_id, id, name, color, position)
  select v_id, j.v->>'id', coalesce(j.v->>'name', ''), coalesce(j.v->>'color', '#888888'), j.n
  from jsonb_array_elements(coalesce(p_layout->'sections', '[]'::jsonb)) with ordinality as j(v, n)
  on conflict (layout_id, id) do update set name = excluded.name, color = excluded.color, position = excluded.position;

  -- Room items
  delete from public.features f
  where f.layout_id = v_id
    and f.id not in (select j.v->>'id' from jsonb_array_elements(coalesce(p_layout->'features', '[]'::jsonb)) as j(v));
  insert into public.features (layout_id, id, kind, label, x, y, width, height, rotation, position)
  select v_id, j.v->>'id', j.v->>'kind', coalesce(j.v->>'label', ''),
         (j.v->>'x')::real, (j.v->>'y')::real, (j.v->>'width')::real, (j.v->>'height')::real,
         coalesce((j.v->>'rotation')::real, 0), j.n
  from jsonb_array_elements(coalesce(p_layout->'features', '[]'::jsonb)) with ordinality as j(v, n)
  on conflict (layout_id, id) do update
    set kind = excluded.kind, label = excluded.label, x = excluded.x, y = excluded.y,
        width = excluded.width, height = excluded.height, rotation = excluded.rotation,
        position = excluded.position;

  -- Tables (deleting one also removes its chairs and any guests on it)
  delete from public.tables t
  where t.layout_id = v_id
    and t.id not in (select j.v->>'id' from jsonb_array_elements(coalesce(p_layout->'tables', '[]'::jsonb)) as j(v));
  insert into public.tables (layout_id, id, name, shape, kind, guest_name, x, y, rotation,
                             seats, normal_seats, chair_kinds, highchairs, section_id, group_id, position)
  select v_id, j.v->>'id', coalesce(j.v->>'name', ''), j.v->>'shape', coalesce(j.v->>'kind', 'regular'),
         coalesce(j.v->>'guestName', ''), (j.v->>'x')::real, (j.v->>'y')::real,
         coalesce((j.v->>'rotation')::real, 0), (j.v->>'seats')::int,
         -- The usual size of a VIP / big group table set to an exact number of chairs (only kept on those).
         case when coalesce(j.v->>'kind', 'regular') in ('vip', 'group')
              then nullif((j.v->>'normalSeats')::int, (j.v->>'seats')::int) end,
         array(select jsonb_array_elements_text(case when jsonb_typeof(j.v->'chairKinds') = 'array'
                                                     then j.v->'chairKinds' else '[]'::jsonb end)),
         coalesce((j.v->>'highchairs')::int, 0),
         -- Only keep the section if it exists in this layout.
         (select s.id from public.sections s where s.layout_id = v_id and s.id = j.v->>'sectionId'),
         -- Big group tables that belong together share a group id (only kept on big group tables).
         case when coalesce(j.v->>'kind', 'regular') = 'group' then nullif(j.v->>'groupId', '') end,
         j.n
  from jsonb_array_elements(coalesce(p_layout->'tables', '[]'::jsonb)) with ordinality as j(v, n)
  on conflict (layout_id, id) do update
    set name = excluded.name, shape = excluded.shape, kind = excluded.kind, guest_name = excluded.guest_name,
        x = excluded.x, y = excluded.y, rotation = excluded.rotation, seats = excluded.seats,
        normal_seats = excluded.normal_seats,
        chair_kinds = excluded.chair_kinds, highchairs = excluded.highchairs, section_id = excluded.section_id,
        group_id = excluded.group_id, position = excluded.position;

  -- Chairs follow the tables: remove seats that no longer exist, add new ones, update the kind.
  delete from public.chairs c
  where c.layout_id = v_id
    and not exists (select 1 from private.wanted_chairs(v_id) w where w.id = c.id and w.table_id = c.table_id);
  insert into public.chairs (layout_id, id, table_id, number, kind)
  select v_id, w.id, w.table_id, w.number, w.kind from private.wanted_chairs(v_id) w
  on conflict (layout_id, id) do update
    set number = excluded.number, kind = excluded.kind
    where public.chairs.number is distinct from excluded.number or public.chairs.kind is distinct from excluded.kind;

  -- Live seating on this layout: seated families that lost all their chairs, and reservations
  -- that lost all their tables, are gone. Then every tablet reloads the seating.
  delete from public.families f
  using public.events e
  where e.layout_id = v_id and e.ended_at is null and f.event_id = e.id and f.status = 'seated'
    and not exists (select 1 from public.chair_assignments a where a.event_id = f.event_id and a.family_id = f.id);
  delete from public.reservations r
  using public.events e
  where e.layout_id = v_id and e.ended_at is null and r.event_id = e.id
    and not exists (select 1 from public.reservation_tables rt where rt.event_id = r.event_id and rt.reservation_id = r.id);
  update public.events set version = version + 1, updated_at = v_now where layout_id = v_id and ended_at is null;

  perform private.bump_restaurant(p_restaurant);
  return v_now;
end;
$$;
