-- =====================================================================
-- 5 · Fast corrections: move a family, recent changes, table spot checks
--
-- Adds:
--   event_changes   a log of every seating change ("Family F12 moved P1 → P3"), shown as "Recent changes"
--   table_checks    when someone last checked a table against the real floor ("Checked" button)
--   move_family()   moves a seated family to other chairs / another table in one transaction
--   check_table()   records a spot check
-- and re-creates the seating functions from file 3 so each one also writes to the log.
-- Same protections as before: the event row is locked, and chair_assignments' primary key
-- refuses a chair that is already taken ("chair_taken").
--
-- Each tablet sends a random device id with every request (header x-device-id), so the
-- log can tell changes made on this tablet from changes made on another one, even when
-- everyone shares one login.
-- =====================================================================

create table public.event_changes (
  event_id  uuid not null references public.events (id) on delete cascade,
  id        bigint generated always as identity,
  at        timestamptz not null default now(),
  -- Who made the change (for individual staff accounts later) and from which device.
  user_id   uuid,
  device_id text,
  message   text not null,
  -- Tables the change was about, so the app can open them from the list.
  table_ids text[] not null default '{}',
  primary key (event_id, id)
);

create table public.table_checks (
  event_id   uuid not null,
  table_id   text not null,
  layout_id  uuid not null,
  checked_at timestamptz not null default now(),
  user_id    uuid,
  device_id  text,
  primary key (event_id, table_id),
  foreign key (event_id, layout_id) references public.events (id, layout_id) on delete cascade,
  foreign key (layout_id, table_id) references public.tables (layout_id, id) on delete cascade
);

alter table public.event_changes enable row level security;
alter table public.table_checks  enable row level security;
revoke all on public.event_changes, public.table_checks from anon;
grant select, insert, update, delete on public.event_changes, public.table_checks to authenticated;
create policy "staff use event changes" on public.event_changes
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
create policy "staff use table checks" on public.table_checks
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));

-- ---------- Helpers ----------

-- The x-device-id header the app sends (null if missing).
create or replace function private.device_id()
returns text
language sql stable set search_path = ''
as $$
  select nullif(left(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-device-id', ''), 64), '');
$$;

-- A table's name as staff know it ("P4"), or its id if it has no name.
create or replace function private.table_label(p_layout uuid, p_table text)
returns text
language sql stable security invoker set search_path = ''
as $$
  select coalesce((select nullif(t.name, '') from public.tables t where t.layout_id = p_layout and t.id = p_table), p_table);
$$;

create or replace function private.log_change(p_event uuid, p_message text, p_tables text[] default '{}')
returns void
language sql security invoker set search_path = ''
as $$
  insert into public.event_changes (event_id, user_id, device_id, message, table_ids)
  values (p_event, (select auth.uid()), private.device_id(), p_message, coalesce(p_tables, '{}'));
$$;

-- ---------- New: move a family ----------

-- Moves a seated family to new chairs (at the same or another table). The family keeps its id;
-- its party size becomes the number of chairs picked. p_color: a color that stands out at the new table.
create or replace function public.move_family(p_event uuid, p_family text, p_table text, p_chairs text[], p_color text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_count  int := (select count(distinct x) from unnest(p_chairs) as x);
  v_from   text;
begin
  select f.table_id into v_from from public.families f
  where f.event_id = p_event and f.id = p_family and f.status = 'seated';
  if not found then
    raise exception 'family_not_found' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    raise exception 'no_chairs' using errcode = 'P0001';
  end if;
  if p_table <> v_from and exists (select 1 from public.reservation_tables rt
                                   where rt.event_id = p_event and rt.table_id = p_table and rt.active) then
    raise exception 'table_reserved' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chairs c
      where c.layout_id = v_layout and c.table_id = p_table and c.id = any (p_chairs)) <> v_count then
    raise exception 'chair_not_found' using errcode = 'P0001';
  end if;

  delete from public.chair_assignments a where a.event_id = p_event and a.family_id = p_family;
  update public.families
  set table_id = p_table, guest_count = v_count, color = coalesce(nullif(p_color, ''), color)
  where event_id = p_event and id = p_family;
  begin
    insert into public.chair_assignments (event_id, chair_id, layout_id, family_id)
    select distinct p_event, x, v_layout, p_family from unnest(p_chairs) as x;
  exception when unique_violation then
    raise exception 'chair_taken' using errcode = 'P0001';
  end;

  perform private.log_change(p_event,
    case when p_table = v_from
      then format('Family %s moved to other chairs at %s', p_family, private.table_label(v_layout, p_table))
      else format('Family %s moved %s → %s', p_family, private.table_label(v_layout, v_from), private.table_label(v_layout, p_table))
    end,
    case when p_table = v_from then array[p_table] else array[v_from, p_table] end);
  perform private.bump_event(p_event);
end;
$$;

-- ---------- New: spot check ----------

create or replace function public.check_table(p_event uuid, p_table text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
begin
  if not exists (select 1 from public.tables t where t.layout_id = v_layout and t.id = p_table) then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;
  insert into public.table_checks (event_id, table_id, layout_id, user_id, device_id)
  values (p_event, p_table, v_layout, (select auth.uid()), private.device_id())
  on conflict (event_id, table_id) do update
    set checked_at = now(), user_id = excluded.user_id, device_id = excluded.device_id;
  perform private.log_change(p_event, format('Checked %s', private.table_label(v_layout, p_table)), array[p_table]);
  perform private.bump_event(p_event);
end;
$$;

-- ---------- The seating functions from file 3, now also writing to the log ----------

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
    raise exception 'chair_taken' using errcode = 'P0001';
  end;

  perform private.log_change(p_event, format('Seated family %s (%s) at %s', v_id, v_count, private.table_label(v_layout, p_table)), array[p_table]);
  perform private.bump_event(p_event);
  return v_id;
end;
$$;

create or replace function public.update_family_chairs(p_event uuid, p_family text, p_chairs text[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_count  int := (select count(distinct x) from unnest(p_chairs) as x);
  v_table  text;
  v_before int;
begin
  select f.table_id, f.guest_count into v_table, v_before from public.families f
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

  perform private.log_change(p_event,
    case when v_count = v_before
      then format('Family %s changed chairs at %s', p_family, private.table_label(v_layout, v_table))
      else format('Family %s now %s at %s (was %s)', p_family, v_count, private.table_label(v_layout, v_table), v_before)
    end,
    array[v_table]);
  perform private.bump_event(p_event);
end;
$$;

create or replace function public.finish_family(p_event uuid, p_family text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_table  text;
begin
  select f.table_id into v_table from public.families f where f.event_id = p_event and f.id = p_family;
  delete from public.chair_assignments a where a.event_id = p_event and a.family_id = p_family;
  update public.families set status = 'done' where event_id = p_event and id = p_family;
  if v_table is not null then
    perform private.log_change(p_event, format('Family %s left %s', p_family, private.table_label(v_layout, v_table)), array[v_table]);
  end if;
  perform private.bump_event(p_event);
end;
$$;

create or replace function public.remove_family(p_event uuid, p_family text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_table  text;
begin
  delete from public.families where event_id = p_event and id = p_family returning table_id into v_table;
  if v_table is not null then
    perform private.log_change(p_event, format('Removed family %s from %s', p_family, private.table_label(v_layout, v_table)), array[v_table]);
  end if;
  perform private.bump_event(p_event);
end;
$$;

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
  perform private.log_change(p_event,
    format('Reserved %s for %s (%s)',
           (select string_agg(private.table_label(v_layout, x), ', ') from unnest(p_tables) as x),
           left(trim(p_name), 100), p_party_size),
    p_tables);
  perform private.bump_event(p_event);
  return v_id;
end;
$$;

create or replace function public.seat_reservation(p_event uuid, p_reservation text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_name   text;
  v_tables text[];
begin
  update public.reservations set status = 'seated'
  where event_id = p_event and id = p_reservation and status = 'reserved'
  returning name into v_name;
  if v_name is not null then
    select array_agg(rt.table_id) into v_tables from public.reservation_tables rt
    where rt.event_id = p_event and rt.reservation_id = p_reservation;
    perform private.log_change(p_event,
      format('Seated party %s at %s', v_name, (select string_agg(private.table_label(v_layout, x), ', ') from unnest(v_tables) as x)),
      v_tables);
  end if;
  perform private.bump_event(p_event);
end;
$$;

create or replace function public.cancel_reservation(p_event uuid, p_reservation text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_name   text;
  v_held   boolean;
  v_tables text[];
begin
  select array_agg(rt.table_id) into v_tables from public.reservation_tables rt
  where rt.event_id = p_event and rt.reservation_id = p_reservation;
  delete from public.reservations where event_id = p_event and id = p_reservation
  returning name, held into v_name, v_held;
  if v_name is not null then
    perform private.log_change(p_event,
      format(case when v_held then 'Released the hold for %s (%s)' else 'Cancelled reservation %s (%s)' end,
             v_name, (select string_agg(private.table_label(v_layout, x), ', ') from unnest(v_tables) as x)),
      coalesce(v_tables, '{}'));
  end if;
  perform private.bump_event(p_event);
end;
$$;

create or replace function public.clear_table(p_event uuid, p_table text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_res    text;
  v_status text;
begin
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
  perform private.log_change(p_event, format('Cleared %s', private.table_label(v_layout, p_table)), array[p_table]);
  perform private.bump_event(p_event);
end;
$$;

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
  delete from public.table_checks where event_id = p_event;
  update public.events set next_family_number = 1, next_reservation_number = 1 where id = p_event;
  perform private.apply_holds(p_event, v_layout, p_groups);
  perform private.log_change(p_event, 'Cleared all seating');
  perform private.bump_event(p_event);
end;
$$;

-- ---------- Reading: now with recent changes and checks ----------

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
      from public.held_tables h where h.event_id = e.id), '[]'::jsonb),
    -- The 40 newest changes, newest first.
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'at', (extract(epoch from c.at) * 1000)::bigint,
        'message', c.message,
        'deviceId', c.device_id,
        'tableIds', to_jsonb(c.table_ids)
      ) order by c.id desc)
      from (select * from public.event_changes ch where ch.event_id = e.id order by ch.id desc limit 40) c), '[]'::jsonb),
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tableId', k.table_id,
        'at', (extract(epoch from k.checked_at) * 1000)::bigint
      ))
      from public.table_checks k where k.event_id = e.id), '[]'::jsonb)
  )
  from public.events e
  where e.id = p_event;
$$;

-- ---------- Who may call what ----------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
