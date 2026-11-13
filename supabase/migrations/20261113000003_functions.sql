-- =====================================================================
-- 3 of 4 · Functions the app calls (supabase.rpc('name', {...}))
--
-- Every seating change is one function call = one database transaction: either all of it
-- happens or none of it does. Each seating function first LOCKS the event row, so changes from
-- several tablets to the same event happen one after another, never interleaved. On top of that,
-- the unique keys from file 1 refuse a chair (or table) that is already taken.
--
-- Errors the app understands (in the error message):
--   chair_taken     another tablet just seated someone on one of these chairs
--   table_taken     the table already has guests or a reservation
--   table_reserved  the table belongs to a reservation (no walk-ins)
--   event_ended     live seating was ended (or the event doesn't exist / isn't yours)
--
-- Functions are "security invoker": they run as the logged-in user, so the RLS rules from
-- file 2 still apply inside them. Only create_restaurant and bump_restaurant need more rights.
-- =====================================================================

-- ---------- Small helpers (private schema: not callable from the app) ----------

-- Locks a live event so other changes to it wait; returns its layout. Fails if it is over or not yours.
create or replace function private.lock_live_event(p_event uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid;
begin
  select e.layout_id into v_layout from public.events e
  where e.id = p_event and e.ended_at is null
  for update;
  if not found then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  return v_layout;
end;
$$;

-- Tells every tablet watching this event to reload it.
create or replace function private.bump_event(p_event uuid)
returns void
language sql security invoker set search_path = ''
as $$
  update public.events set version = version + 1, updated_at = now() where id = p_event;
$$;

-- Tells every tablet of this restaurant that its layouts or live events changed.
-- (Security definer because only owners may update the restaurant row itself.)
create or replace function private.bump_restaurant(p_restaurant uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.is_staff(p_restaurant) then
    update public.restaurants set version = version + 1 where id = p_restaurant;
  end if;
end;
$$;

-- The chairs a layout's tables should have: seats "T1-1".."T1-n" and highchairs "T1-h1"...
create or replace function private.wanted_chairs(p_layout uuid)
returns table (id text, table_id text, number int, kind text)
language sql stable security invoker set search_path = ''
as $$
  select t.id || '-' || n, t.id, n,
         case when t.chair_kinds[n] = 'wheelchair' then 'wheelchair' else 'standard' end
  from public.tables t
  cross join lateral generate_series(1, t.seats) as n
  where t.layout_id = p_layout
  union all
  select t.id || '-h' || k, t.id, t.seats + k, 'highchair'
  from public.tables t
  cross join lateral generate_series(1, t.highchairs) as k
  where t.layout_id = p_layout;
$$;

-- True if the table has seated guests or an active reservation in this event.
create or replace function private.table_busy(p_event uuid, p_table text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (select 1 from public.families f
                 where f.event_id = p_event and f.table_id = p_table and f.status = 'seated')
      or exists (select 1 from public.reservation_tables rt
                 where rt.event_id = p_event and rt.table_id = p_table and rt.active);
$$;

-- Holds VIP / big-group tables for their party (same rules as before in the app):
-- p_groups = [{ "name": "Mayor Kealoha", "partySize": 16, "tableIds": ["T3", "T4"] }, ...]
-- Returns true if anything changed. The caller must hold the event lock.
create or replace function private.apply_holds(p_event uuid, p_layout uuid, p_groups jsonb)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  g          jsonb;
  v_name     text;
  v_size     int;
  v_tables   text[];
  v_existing text;
  v_fresh    text[];
  v_id       text;
  v_changed  boolean := false;
begin
  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    v_name := left(trim(g->>'name'), 100);
    v_size := greatest(coalesce((g->>'partySize')::int, 1), 1);
    -- Only tables that really exist in this layout.
    select coalesce(array_agg(t.id), '{}') into v_tables
    from public.tables t
    where t.layout_id = p_layout
      and t.id in (select jsonb_array_elements_text(coalesce(g->'tableIds', '[]'::jsonb)));
    if v_name is null or v_name = '' or cardinality(v_tables) = 0 then
      continue;
    end if;

    -- Still waiting for the party: keep its name and size in step with the layout.
    select r.id into v_existing
    from public.reservations r
    join public.reservation_tables rt on rt.event_id = r.event_id and rt.reservation_id = r.id
    where r.event_id = p_event and r.held and r.status = 'reserved' and rt.active and rt.table_id = any (v_tables)
    limit 1;
    if v_existing is not null then
      update public.reservations set name = v_name, party_size = v_size
      where event_id = p_event and id = v_existing and (name <> v_name or party_size <> v_size);
      v_changed := v_changed or found;
      continue;
    end if;

    -- Hold the tables that weren't held yet this event and are free.
    select coalesce(array_agg(x), '{}') into v_fresh
    from unnest(v_tables) as x
    where not exists (select 1 from public.held_tables h where h.event_id = p_event and h.table_id = x)
      and not private.table_busy(p_event, x);
    if cardinality(v_fresh) = 0 then
      continue;
    end if;

    update public.events set next_reservation_number = next_reservation_number + 1
    where id = p_event returning 'R' || (next_reservation_number - 1) into v_id;
    insert into public.reservations (event_id, id, name, party_size, held)
    values (p_event, v_id, v_name, v_size, true);
    insert into public.reservation_tables (event_id, reservation_id, layout_id, table_id)
    select p_event, v_id, p_layout, x from unnest(v_fresh) as x;
    insert into public.held_tables (event_id, table_id, layout_id)
    select p_event, x, p_layout from unnest(v_fresh) as x;
    v_changed := true;
  end loop;
  return v_changed;
end;
$$;

-- ---------- Restaurant ----------

-- First login with a brand-new account: make the restaurant and become its owner.
create or replace function public.create_restaurant(p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not_logged_in' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_members m where m.user_id = v_user) then
    raise exception 'already_has_restaurant' using errcode = 'P0001';
  end if;
  insert into public.restaurants (name) values (trim(p_name)) returning id into v_id;
  insert into public.staff_members (restaurant_id, user_id, role) values (v_id, v_user, 'owner');
  return v_id;
end;
$$;

-- ---------- Layouts ----------

-- Saves a whole layout in the app's RestaurantLayout shape (JSON), creating or replacing it.
-- Tables, sections and room items no longer in it are deleted; chairs are rebuilt from the tables.
-- Guests on deleted tables / chairs are removed from live seating, like the app did before.
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
                             seats, chair_kinds, highchairs, section_id, position)
  select v_id, j.v->>'id', coalesce(j.v->>'name', ''), j.v->>'shape', coalesce(j.v->>'kind', 'regular'),
         coalesce(j.v->>'guestName', ''), (j.v->>'x')::real, (j.v->>'y')::real,
         coalesce((j.v->>'rotation')::real, 0), (j.v->>'seats')::int,
         array(select jsonb_array_elements_text(case when jsonb_typeof(j.v->'chairKinds') = 'array'
                                                     then j.v->'chairKinds' else '[]'::jsonb end)),
         coalesce((j.v->>'highchairs')::int, 0),
         -- Only keep the section if it exists in this layout.
         (select s.id from public.sections s where s.layout_id = v_id and s.id = j.v->>'sectionId'),
         j.n
  from jsonb_array_elements(coalesce(p_layout->'tables', '[]'::jsonb)) with ordinality as j(v, n)
  on conflict (layout_id, id) do update
    set name = excluded.name, shape = excluded.shape, kind = excluded.kind, guest_name = excluded.guest_name,
        x = excluded.x, y = excluded.y, rotation = excluded.rotation, seats = excluded.seats,
        chair_kinds = excluded.chair_kinds, highchairs = excluded.highchairs, section_id = excluded.section_id,
        position = excluded.position;

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

create or replace function public.delete_layout(p_layout uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_restaurant uuid;
begin
  delete from public.layouts where id = p_layout returning restaurant_id into v_restaurant;
  if v_restaurant is not null then
    perform private.bump_restaurant(v_restaurant);
  end if;
end;
$$;

-- ---------- Live seating: start, read, end ----------

-- Joins the layout's live event, or starts one. Two tablets starting at once get the same event.
create or replace function public.start_event(p_layout uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_restaurant uuid;
  v_id         uuid;
begin
  select l.restaurant_id into v_restaurant from public.layouts l where l.id = p_layout;
  if not found then
    raise exception 'layout_not_found' using errcode = 'P0001';
  end if;
  select e.id into v_id from public.events e where e.layout_id = p_layout and e.ended_at is null;
  if found then
    return v_id;
  end if;
  insert into public.events (restaurant_id, layout_id) values (v_restaurant, p_layout)
  on conflict (layout_id) where ended_at is null do nothing
  returning id into v_id;
  if v_id is null then -- another tablet started it a moment ago
    select e.id into v_id from public.events e where e.layout_id = p_layout and e.ended_at is null;
  else
    perform private.bump_restaurant(v_restaurant);
  end if;
  return v_id;
end;
$$;

-- Everything about one event, in the app's EventState shape.
create or replace function public.get_event_state(p_event uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'layoutId', e.layout_id,
    'version', e.version,
    'ended', e.ended_at is not null,
    'nextFamilyNumber', e.next_family_number,
    'nextReservationNumber', e.next_reservation_number,
    'families', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'tableId', f.table_id,
        'chairIds', coalesce((
          select jsonb_agg(a.chair_id order by c.number)
          from public.chair_assignments a
          join public.chairs c on c.layout_id = a.layout_id and c.id = a.chair_id
          where a.event_id = f.event_id and a.family_id = f.id), '[]'::jsonb),
        'color', f.color,
        'status', f.status,
        'guestCount', f.guest_count,
        'createdAt', (extract(epoch from f.created_at) * 1000)::bigint
      ) order by f.created_at, f.id)
      from public.families f where f.event_id = e.id), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'tableIds', coalesce((
          select jsonb_agg(rt.table_id order by rt.table_id)
          from public.reservation_tables rt
          where rt.event_id = r.event_id and rt.reservation_id = r.id), '[]'::jsonb),
        'partySize', r.party_size,
        'status', r.status,
        'held', r.held,
        'createdAt', (extract(epoch from r.created_at) * 1000)::bigint
      ) order by r.created_at, r.id)
      from public.reservations r where r.event_id = e.id), '[]'::jsonb),
    'heldTableIds', coalesce((
      select jsonb_agg(h.table_id order by h.table_id)
      from public.held_tables h where h.event_id = e.id), '[]'::jsonb)
  )
  from public.events e
  where e.id = p_event;
$$;

-- Live events of a restaurant with how many guests sit there now (for the home menu).
create or replace function public.live_events(p_restaurant uuid)
returns table (layout_id uuid, event_id uuid, guests_seated int)
language sql stable security invoker set search_path = ''
as $$
  select e.layout_id, e.id,
    (coalesce((select sum(f.guest_count) from public.families f
               where f.event_id = e.id and f.status = 'seated'), 0)
   + coalesce((select sum(r.party_size) from public.reservations r
               where r.event_id = e.id and r.status = 'seated'), 0))::int
  from public.events e
  where e.restaurant_id = p_restaurant and e.ended_at is null;
$$;

create or replace function public.end_event(p_event uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_restaurant uuid;
begin
  perform private.lock_live_event(p_event);
  update public.events set ended_at = now(), version = version + 1, updated_at = now()
  where id = p_event returning restaurant_id into v_restaurant;
  perform private.bump_restaurant(v_restaurant);
end;
$$;

-- ---------- Live seating: changes ----------

-- Seats a new walk-in family on some chairs of one table. Returns its id ("F7").
create or replace function public.seat_family(p_event uuid, p_table text, p_chairs text[], p_color text)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_count  int := (select count(distinct x) from unnest(p_chairs) as x);
  v_id     text;
begin
  if v_count = 0 then
    raise exception 'no_chairs' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reservation_tables rt
             where rt.event_id = p_event and rt.table_id = p_table and rt.active) then
    raise exception 'table_reserved' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chairs c
      where c.layout_id = v_layout and c.table_id = p_table and c.id = any (p_chairs)) <> v_count then
    raise exception 'chair_not_found' using errcode = 'P0001';
  end if;

  update public.events set next_family_number = next_family_number + 1
  where id = p_event returning 'F' || (next_family_number - 1) into v_id;
  insert into public.families (event_id, id, layout_id, table_id, color, guest_count)
  values (p_event, v_id, v_layout, p_table, p_color, v_count);
  begin
    insert into public.chair_assignments (event_id, chair_id, layout_id, family_id)
    select distinct p_event, x, v_layout, v_id from unnest(p_chairs) as x;
  exception when unique_violation then
    -- The primary key on chair_assignments refused it: someone already sits there.
    raise exception 'chair_taken' using errcode = 'P0001';
  end;

  perform private.bump_event(p_event);
  return v_id;
end;
$$;

-- Moves a seated family to a new set of chairs at the same table.
create or replace function public.update_family_chairs(p_event uuid, p_family text, p_chairs text[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_count  int := (select count(distinct x) from unnest(p_chairs) as x);
  v_table  text;
begin
  select f.table_id into v_table from public.families f
  where f.event_id = p_event and f.id = p_family and f.status = 'seated';
  if not found then
    raise exception 'family_not_found' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    raise exception 'no_chairs' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chairs c
      where c.layout_id = v_layout and c.table_id = v_table and c.id = any (p_chairs)) <> v_count then
    raise exception 'chair_not_found' using errcode = 'P0001';
  end if;

  delete from public.chair_assignments a where a.event_id = p_event and a.family_id = p_family;
  begin
    insert into public.chair_assignments (event_id, chair_id, layout_id, family_id)
    select distinct p_event, x, v_layout, p_family from unnest(p_chairs) as x;
  exception when unique_violation then
    raise exception 'chair_taken' using errcode = 'P0001';
  end;
  update public.families set guest_count = v_count where event_id = p_event and id = p_family;
  perform private.bump_event(p_event);
end;
$$;

-- The family left: chairs are free again, but they still count as guests who came.
create or replace function public.finish_family(p_event uuid, p_family text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.lock_live_event(p_event);
  delete from public.chair_assignments a where a.event_id = p_event and a.family_id = p_family;
  update public.families set status = 'done' where event_id = p_event and id = p_family;
  perform private.bump_event(p_event);
end;
$$;

-- Entered by mistake: the family is deleted completely.
create or replace function public.remove_family(p_event uuid, p_family text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.lock_live_event(p_event);
  delete from public.families where event_id = p_event and id = p_family;
  perform private.bump_event(p_event);
end;
$$;

-- Reserves whole tables for a named party. Returns its id ("R3").
create or replace function public.create_reservation(p_event uuid, p_name text, p_party_size int, p_tables text[])
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_id     text;
begin
  if coalesce(trim(p_name), '') = '' or p_party_size < 1 or coalesce(cardinality(p_tables), 0) = 0 then
    raise exception 'bad_reservation' using errcode = 'P0001';
  end if;
  if (select count(*) from public.tables t where t.layout_id = v_layout and t.id = any (p_tables))
     <> (select count(distinct x) from unnest(p_tables) as x) then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_tables) as x where private.table_busy(p_event, x)) then
    raise exception 'table_taken' using errcode = 'P0001';
  end if;

  update public.events set next_reservation_number = next_reservation_number + 1
  where id = p_event returning 'R' || (next_reservation_number - 1) into v_id;
  insert into public.reservations (event_id, id, name, party_size)
  values (p_event, v_id, left(trim(p_name), 100), p_party_size);
  begin
    insert into public.reservation_tables (event_id, reservation_id, layout_id, table_id)
    select distinct p_event, v_id, v_layout, x from unnest(p_tables) as x;
  exception when unique_violation then
    raise exception 'table_taken' using errcode = 'P0001';
  end;
  perform private.bump_event(p_event);
  return v_id;
end;
$$;

create or replace function public.seat_reservation(p_event uuid, p_reservation text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.lock_live_event(p_event);
  update public.reservations set status = 'seated'
  where event_id = p_event and id = p_reservation and status = 'reserved';
  perform private.bump_event(p_event);
end;
$$;

-- Cancels a reservation, or releases a VIP / big-group hold (it won't be held again this event).
create or replace function public.cancel_reservation(p_event uuid, p_reservation text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.lock_live_event(p_event);
  delete from public.reservations where event_id = p_event and id = p_reservation;
  perform private.bump_event(p_event);
end;
$$;

-- Families at the table are marked done; an unseated reservation is cancelled,
-- a seated one is marked done (which frees all of its tables).
create or replace function public.clear_table(p_event uuid, p_table text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_res    text;
  v_status text;
begin
  perform private.lock_live_event(p_event);
  delete from public.chair_assignments a
  using public.families f
  where f.event_id = p_event and f.table_id = p_table and f.status = 'seated'
    and a.event_id = f.event_id and a.family_id = f.id;
  update public.families set status = 'done'
  where event_id = p_event and table_id = p_table and status = 'seated';

  select r.id, r.status into v_res, v_status
  from public.reservations r
  join public.reservation_tables rt on rt.event_id = r.event_id and rt.reservation_id = r.id
  where r.event_id = p_event and rt.table_id = p_table and rt.active
  limit 1;
  if v_status = 'reserved' then
    delete from public.reservations where event_id = p_event and id = v_res;
  elsif v_status = 'seated' then
    update public.reservations set status = 'done' where event_id = p_event and id = v_res;
    update public.reservation_tables set active = false where event_id = p_event and reservation_id = v_res;
  end if;
  perform private.bump_event(p_event);
end;
$$;

-- "Clear all seating": everyone and every reservation is cleared, then VIP / big-group tables are held again.
create or replace function public.reset_event(p_event uuid, p_groups jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
begin
  delete from public.families where event_id = p_event;
  delete from public.reservations where event_id = p_event;
  delete from public.held_tables where event_id = p_event;
  update public.events set next_family_number = 1, next_reservation_number = 1 where id = p_event;
  perform private.apply_holds(p_event, v_layout, p_groups);
  perform private.bump_event(p_event);
end;
$$;

-- Called when seating opens and after layout edits: hold VIP / big-group tables that need it.
create or replace function public.sync_holds(p_event uuid, p_groups jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
begin
  if private.apply_holds(p_event, v_layout, p_groups) then
    perform private.bump_event(p_event);
  end if;
end;
$$;

-- ---------- Who may call what ----------
-- Functions are callable by everyone by default; only logged-in staff should be able to.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
