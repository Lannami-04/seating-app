-- =====================================================================
-- 6 · Reservations over several tables act as one party
--
-- Adds:
--   unseat_reservation()  "Back to reserved": a seated party goes back to waiting (all its tables at once)
--   two triggers that make the database itself refuse walk-ins on reserved tables:
--     • no chair can be assigned at a table that belongs to an active reservation
--     • no table with guests on it can be added to a reservation
--   (the seating functions already check this; the triggers also cover anything that writes rows directly,
--   the same way the chair_assignments primary key does for double-booked chairs)
-- Seating, clearing and releasing a reservation already act on all of its tables (reservation_tables).
-- =====================================================================

create or replace function public.unseat_reservation(p_event uuid, p_reservation text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
  v_name   text;
  v_tables text[];
begin
  update public.reservations set status = 'reserved'
  where event_id = p_event and id = p_reservation and status = 'seated'
  returning name into v_name;
  if v_name is not null then
    select array_agg(rt.table_id order by rt.table_id) into v_tables from public.reservation_tables rt
    where rt.event_id = p_event and rt.reservation_id = p_reservation;
    perform private.log_change(p_event,
      format('Party %s back to reserved (%s)', v_name,
             (select string_agg(private.table_label(v_layout, x), ', ') from unnest(v_tables) as x)),
      v_tables);
  end if;
  perform private.bump_event(p_event);
end;
$$;

-- A chair may not be given to a walk-in family while its table belongs to an active reservation.
create or replace function private.refuse_chair_at_reserved_table()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.chairs c
    join public.reservation_tables rt
      on rt.event_id = new.event_id and rt.layout_id = c.layout_id and rt.table_id = c.table_id and rt.active
    where c.layout_id = new.layout_id and c.id = new.chair_id
  ) then
    raise exception 'table_reserved' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger chair_assignments_not_at_reserved_table
  before insert or update on public.chair_assignments
  for each row execute function private.refuse_chair_at_reserved_table();

-- A table with guests sitting on it can't become part of a reservation.
create or replace function private.refuse_reserving_occupied_table()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.active and exists (
    select 1
    from public.chair_assignments a
    join public.chairs c on c.layout_id = a.layout_id and c.id = a.chair_id
    where a.event_id = new.event_id and c.layout_id = new.layout_id and c.table_id = new.table_id
  ) then
    raise exception 'table_taken' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger reservation_tables_not_occupied
  before insert or update on public.reservation_tables
  for each row execute function private.refuse_reserving_occupied_table();

-- ---------- Who may call what ----------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
