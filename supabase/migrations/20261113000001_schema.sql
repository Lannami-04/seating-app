-- =====================================================================
-- 1 of 4 · Tables
-- The data shapes from src/types.ts, stored in Postgres.
--
--   restaurants ─┬─ staff_members (who may log in for this restaurant)
--                └─ layouts ─┬─ sections
--                            ├─ features            (stage, divider, bar...)
--                            ├─ tables ── chairs    (chairs are generated from tables by save_layout)
--                            └─ events  (one "live seating" session)
--                                  ├─ families ── chair_assignments   (who sits on which chair)
--                                  ├─ reservations ── reservation_tables
--                                  └─ held_tables  (VIP / big-group tables already held this event)
--
-- Ids of things inside a layout (tables, chairs, sections, features) are the app's own text ids
-- ("T12", "T12-3"), unique inside their layout, so their primary keys are (layout_id, id).
-- Families and reservations keep the app's "F7" / "R3" ids, unique inside their event.
-- =====================================================================

create table public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 100),
  -- Bumped whenever the list of layouts or live events changes; tablets listen for it.
  version    bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Who may use a restaurant. Today: one shared staff login per restaurant.
-- Later: one row per person, each with their own login and role.
create table public.staff_members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  display_name  text,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index staff_members_user_idx on public.staff_members (user_id);

create table public.layouts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 100),
  width         real not null check (width > 0),
  height        real not null check (height > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Lets events prove their layout belongs to the same restaurant.
  unique (id, restaurant_id)
);
create index layouts_restaurant_idx on public.layouts (restaurant_id);

create table public.sections (
  layout_id uuid not null references public.layouts (id) on delete cascade,
  id        text not null,
  name      text not null,
  color     text not null,
  -- Order in the app's list (kept so every tablet draws things in the same order).
  position  int  not null default 0,
  primary key (layout_id, id)
);

create table public.features (
  layout_id uuid not null references public.layouts (id) on delete cascade,
  id        text not null,
  kind      text not null check (kind in ('stage', 'divider', 'bar', 'buffet', 'entrance')),
  label     text not null default '',
  x         real not null,
  y         real not null,
  width     real not null check (width > 0),
  height    real not null check (height > 0),
  rotation  real not null default 0,
  position  int  not null default 0,
  primary key (layout_id, id)
);

create table public.tables (
  layout_id   uuid not null references public.layouts (id) on delete cascade,
  id          text not null,
  name        text not null,
  shape       text not null check (shape in ('circle', 'square', 'rectangle')),
  kind        text not null default 'regular' check (kind in ('regular', 'vip', 'group')),
  guest_name  text not null default '',
  x           real not null,
  y           real not null,
  rotation    real not null default 0,
  seats       int  not null check (seats between 1 and 60),
  -- chair_kinds[1] is seat 1: 'standard' or 'wheelchair' (wheelchair seats still count as seats).
  chair_kinds text[] not null default '{}',
  -- Extra highchairs beside the table; they don't use up a seat.
  highchairs  int  not null default 0 check (highchairs between 0 and 10),
  section_id  text,
  position    int  not null default 0,
  primary key (layout_id, id),
  -- Deleting a section leaves its tables without a section (only section_id is cleared).
  foreign key (layout_id, section_id) references public.sections (layout_id, id) on delete set null (section_id)
);

-- One row per seat and highchair, so chair assignments can point at a real chair.
-- Ids match the app: "<tableId>-<n>" for seats, "<tableId>-h<n>" for highchairs.
create table public.chairs (
  layout_id uuid not null,
  id        text not null,
  table_id  text not null,
  number    int  not null check (number >= 1),
  kind      text not null check (kind in ('standard', 'wheelchair', 'highchair')),
  primary key (layout_id, id),
  foreign key (layout_id, table_id) references public.tables (layout_id, id) on delete cascade
);
create index chairs_table_idx on public.chairs (layout_id, table_id);

-- One live-seating session on a layout ("Seat guests" until "End live seating").
create table public.events (
  id                      uuid primary key default gen_random_uuid(),
  restaurant_id           uuid not null references public.restaurants (id) on delete cascade,
  layout_id               uuid not null,
  next_family_number      int not null default 1,
  next_reservation_number int not null default 1,
  -- Bumped by every seating change. Tablets listen for it and reload the seating.
  version                 bigint not null default 0,
  started_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  ended_at                timestamptz,
  -- Lets child rows prove they belong to the same layout as their event (see the foreign keys below).
  unique (id, layout_id),
  -- The layout must belong to the event's own restaurant.
  foreign key (layout_id, restaurant_id) references public.layouts (id, restaurant_id) on delete cascade
);
-- At most one live (not ended) event per layout, so every tablet joins the same one.
create unique index events_one_live_per_layout on public.events (layout_id) where ended_at is null;
create index events_restaurant_idx on public.events (restaurant_id);

-- A walk-in party sitting together at one table.
create table public.families (
  event_id    uuid not null,
  id          text not null,                -- "F7"
  layout_id   uuid not null,
  table_id    text not null,
  color       text not null,
  status      text not null default 'seated' check (status in ('seated', 'done')),
  guest_count int  not null check (guest_count >= 0),
  created_at  timestamptz not null default now(),
  primary key (event_id, id),
  foreign key (event_id, layout_id) references public.events (id, layout_id) on delete cascade,
  foreign key (layout_id, table_id) references public.tables (layout_id, id) on delete cascade
);
create index families_table_idx on public.families (event_id, table_id);

-- ★ Double-booking protection ★
-- The primary key (event_id, chair_id) means the database itself refuses a second guest on the
-- same chair in the same event, no matter how many tablets try at the same moment.
create table public.chair_assignments (
  event_id  uuid not null,
  chair_id  text not null,
  layout_id uuid not null,
  family_id text not null,
  primary key (event_id, chair_id),
  foreign key (event_id, layout_id) references public.events (id, layout_id) on delete cascade,
  foreign key (event_id, family_id) references public.families (event_id, id) on delete cascade,
  foreign key (layout_id, chair_id) references public.chairs (layout_id, id) on delete cascade
);
create index chair_assignments_family_idx on public.chair_assignments (event_id, family_id);

-- A named party that owns whole tables (made by the hostess, or "held" automatically for VIP / big-group tables).
create table public.reservations (
  event_id   uuid not null references public.events (id) on delete cascade,
  id         text not null,                 -- "R3"
  name       text not null check (length(trim(name)) between 1 and 100),
  party_size int  not null check (party_size >= 1),
  status     text not null default 'reserved' check (status in ('reserved', 'seated', 'done')),
  held       boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_id, id)
);

create table public.reservation_tables (
  event_id       uuid not null,
  reservation_id text not null,
  layout_id      uuid not null,
  table_id       text not null,
  -- False once the party is done: the table is free again but the history is kept.
  active         boolean not null default true,
  primary key (event_id, reservation_id, table_id),
  foreign key (event_id, layout_id) references public.events (id, layout_id) on delete cascade,
  foreign key (event_id, reservation_id) references public.reservations (event_id, id) on delete cascade,
  foreign key (layout_id, table_id) references public.tables (layout_id, id) on delete cascade
);
-- A table can belong to only one active reservation per event (same idea as the chairs).
create unique index reservation_tables_one_active on public.reservation_tables (event_id, table_id) where active;

-- VIP / big-group tables that already got their automatic hold this event,
-- so a hold the hostess released isn't put back.
create table public.held_tables (
  event_id  uuid not null,
  table_id  text not null,
  layout_id uuid not null,
  primary key (event_id, table_id),
  foreign key (event_id, layout_id) references public.events (id, layout_id) on delete cascade,
  foreign key (layout_id, table_id) references public.tables (layout_id, id) on delete cascade
);
