-- =====================================================================
-- 2 of 4 · Who may see and change what (Row Level Security)
--
-- With RLS turned on, Postgres checks a rule ("policy") for every row a user reads or writes.
-- The rule everywhere is the same: you must be logged in AND be staff of the restaurant the row
-- belongs to. Logged-out visitors (the "anon" role) get nothing at all.
-- =====================================================================

-- Helper functions live in a schema the API doesn't expose, so they can't be called from the app directly.
create schema if not exists private;
grant usage on schema private to authenticated;

-- "security definer" = runs with the owner's rights, so it can look at staff_members
-- without itself being blocked by RLS (which would otherwise loop forever).
create or replace function private.is_staff(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members m
    where m.restaurant_id = p_restaurant and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_owner(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members m
    where m.restaurant_id = p_restaurant and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create or replace function private.can_use_layout(p_layout uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.layouts l
    join public.staff_members m on m.restaurant_id = l.restaurant_id
    where l.id = p_layout and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_use_event(p_event uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    join public.staff_members m on m.restaurant_id = e.restaurant_id
    where e.id = p_event and m.user_id = (select auth.uid())
  );
$$;

grant execute on function private.is_staff(uuid), private.is_owner(uuid),
  private.can_use_layout(uuid), private.can_use_event(uuid) to authenticated;

-- ---------- Turn RLS on for every table ----------
alter table public.restaurants        enable row level security;
alter table public.staff_members      enable row level security;
alter table public.layouts            enable row level security;
alter table public.sections           enable row level security;
alter table public.features           enable row level security;
alter table public.tables             enable row level security;
alter table public.chairs             enable row level security;
alter table public.events             enable row level security;
alter table public.families           enable row level security;
alter table public.chair_assignments  enable row level security;
alter table public.reservations       enable row level security;
alter table public.reservation_tables enable row level security;
alter table public.held_tables        enable row level security;

-- Logged-out visitors get no access at all; logged-in users still pass the policies below.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------- Restaurants and staff ----------
-- New restaurants are made with the create_restaurant() function (it also adds you as owner).
create policy "staff read their restaurant" on public.restaurants
  for select to authenticated using (private.is_staff(id));
create policy "owners rename their restaurant" on public.restaurants
  for update to authenticated using (private.is_owner(id)) with check (private.is_owner(id));
create policy "owners delete their restaurant" on public.restaurants
  for delete to authenticated using (private.is_owner(id));

create policy "staff see their colleagues" on public.staff_members
  for select to authenticated using (user_id = (select auth.uid()) or private.is_staff(restaurant_id));
-- Ready for individual staff accounts later: owners add, change and remove staff.
create policy "owners add staff" on public.staff_members
  for insert to authenticated with check (private.is_owner(restaurant_id));
create policy "owners change staff" on public.staff_members
  for update to authenticated using (private.is_owner(restaurant_id)) with check (private.is_owner(restaurant_id));
create policy "owners remove staff" on public.staff_members
  for delete to authenticated using (private.is_owner(restaurant_id));

-- ---------- Everything that belongs to a restaurant ----------
create policy "staff use layouts" on public.layouts
  for all to authenticated using (private.is_staff(restaurant_id)) with check (private.is_staff(restaurant_id));
create policy "staff use events" on public.events
  for all to authenticated using (private.is_staff(restaurant_id)) with check (private.is_staff(restaurant_id));

create policy "staff use sections" on public.sections
  for all to authenticated using (private.can_use_layout(layout_id)) with check (private.can_use_layout(layout_id));
create policy "staff use features" on public.features
  for all to authenticated using (private.can_use_layout(layout_id)) with check (private.can_use_layout(layout_id));
create policy "staff use tables" on public.tables
  for all to authenticated using (private.can_use_layout(layout_id)) with check (private.can_use_layout(layout_id));
create policy "staff use chairs" on public.chairs
  for all to authenticated using (private.can_use_layout(layout_id)) with check (private.can_use_layout(layout_id));

-- Event rows also carry layout_id; the foreign keys to events(id, layout_id) make sure it is the event's own layout.
create policy "staff use families" on public.families
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
create policy "staff use chair assignments" on public.chair_assignments
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
create policy "staff use reservations" on public.reservations
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
create policy "staff use reservation tables" on public.reservation_tables
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
create policy "staff use held tables" on public.held_tables
  for all to authenticated using (private.can_use_event(event_id)) with check (private.can_use_event(event_id));
