-- =====================================================================
-- 7 · Big groups: tables made into one big group act as ONE party
--
-- Until now, big group tables only counted as one party when they had the same name; unnamed big group
-- tables were each held on their own (double-tapping one seated only that table). Now each table has a
-- group_id: tables made into a big group together share it, and the group is held as one reservation.
--
--   1. tables.group_id, filled in for existing big group tables: same name = one group; unnamed ones in
--      the same section = one group; unnamed ones without a section stay on their own
--   2. save_layout stores it (the app sends groupId)
--   3. holding VIP / big group tables: a party is one reservation. Tables of the party that were held
--      separately before are merged into it, and tables added to the group later join it.
-- =====================================================================

alter table public.tables add column if not exists group_id text;

update public.tables t
set group_id = case
  when trim(t.guest_name) <> '' then 'legacy-name-' || md5(lower(trim(t.guest_name)))
  when t.section_id is not null then 'legacy-section-' || t.section_id
  else 'legacy-table-' || t.id
end
where t.kind = 'group' and t.group_id is null;

-- save_layout: same as before, plus group_id.
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
                             seats, chair_kinds, highchairs, section_id, group_id, position)
  select v_id, j.v->>'id', coalesce(j.v->>'name', ''), j.v->>'shape', coalesce(j.v->>'kind', 'regular'),
         coalesce(j.v->>'guestName', ''), (j.v->>'x')::real, (j.v->>'y')::real,
         coalesce((j.v->>'rotation')::real, 0), (j.v->>'seats')::int,
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


-- Holds VIP / big group tables for their party. p_groups = [{ "name", "partySize", "tableIds" }, ...]
-- (one entry per party, worked out by the app from the group id / names). Returns true if anything changed.
-- The caller must hold the event lock.
create or replace function private.apply_holds(p_event uuid, p_layout uuid, p_groups jsonb)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  g          jsonb;
  v_name     text;
  v_size     int;
  v_tables   text[];
  v_holds    text[];
  v_keep     text;
  v_fresh    text[];
  v_changed  boolean := false;
begin
  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    v_name := left(trim(g->>'name'), 100);
    v_size := greatest(coalesce((g->>'partySize')::int, 1), 1);
    select coalesce(array_agg(t.id), '{}') into v_tables
    from public.tables t
    where t.layout_id = p_layout
      and t.id in (select jsonb_array_elements_text(coalesce(g->'tableIds', '[]'::jsonb)));
    if v_name is null or v_name = '' or cardinality(v_tables) = 0 then
      continue;
    end if;

    -- Held reservations (party not arrived yet) that already cover some of this party's tables.
    select coalesce(array_agg(distinct r.id), '{}') into v_holds
    from public.reservations r
    join public.reservation_tables rt on rt.event_id = r.event_id and rt.reservation_id = r.id
    where r.event_id = p_event and r.held and r.status = 'reserved' and rt.active and rt.table_id = any (v_tables);

    if cardinality(v_holds) > 0 then
      v_keep := (select min(x) from unnest(v_holds) as x);
      -- One party = one reservation: move the other holds' tables into it, then drop the empty holds.
      if cardinality(v_holds) > 1 then
        update public.reservation_tables
        set reservation_id = v_keep
        where event_id = p_event and reservation_id = any (v_holds) and reservation_id <> v_keep
          and table_id = any (v_tables);
        delete from public.reservations r
        where r.event_id = p_event and r.id = any (v_holds) and r.id <> v_keep
          and not exists (select 1 from public.reservation_tables rt
                          where rt.event_id = r.event_id and rt.reservation_id = r.id);
        v_changed := true;
      end if;
      -- Tables added to the group later (free and not held yet this event) join the party.
      select coalesce(array_agg(x), '{}') into v_fresh
      from unnest(v_tables) as x
      where not exists (select 1 from public.held_tables h where h.event_id = p_event and h.table_id = x)
        and not private.table_busy(p_event, x);
      if cardinality(v_fresh) > 0 then
        insert into public.reservation_tables (event_id, reservation_id, layout_id, table_id)
        select p_event, v_keep, p_layout, x from unnest(v_fresh) as x;
        insert into public.held_tables (event_id, table_id, layout_id)
        select p_event, x, p_layout from unnest(v_fresh) as x;
        v_changed := true;
      end if;
      update public.reservations set name = v_name, party_size = v_size
      where event_id = p_event and id = v_keep and (name <> v_name or party_size <> v_size);
      v_changed := v_changed or found;
      continue;
    end if;

    -- Not held yet: hold the free tables that weren't held yet this event, as one reservation.
    select coalesce(array_agg(x), '{}') into v_fresh
    from unnest(v_tables) as x
    where not exists (select 1 from public.held_tables h where h.event_id = p_event and h.table_id = x)
      and not private.table_busy(p_event, x);
    if cardinality(v_fresh) = 0 then
      continue;
    end if;
    update public.events set next_reservation_number = next_reservation_number + 1
    where id = p_event returning 'R' || (next_reservation_number - 1) into v_keep;
    insert into public.reservations (event_id, id, name, party_size, held)
    values (p_event, v_keep, v_name, v_size, true);
    insert into public.reservation_tables (event_id, reservation_id, layout_id, table_id)
    select p_event, v_keep, p_layout, x from unnest(v_fresh) as x;
    insert into public.held_tables (event_id, table_id, layout_id)
    select p_event, x, p_layout from unnest(v_fresh) as x;
    v_changed := true;
  end loop;
  return v_changed;
end;
$$;

-- ---------- Who may call what ----------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
