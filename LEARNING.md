# Learning the Seating App (a guide for Java developers)

This is a tablet app for restaurant seating. You **design** a restaurant's floor (tables, sections, stage,
dividers...), then switch to **live seating**, where the hostess taps a table and taps chairs to seat guests.
Several tablets can be used at once: they share everything through a **Supabase** database and update each
other within about a second.
It is written in **TypeScript** (JavaScript with types, which will feel familiar from Java)
using **React** (a library for building screens out of components).

## How the app flows

```
Log in (staff email + password)
  └─ first login only: "Set up your restaurant" (name it)
Home menu (the restaurant's name)
  ├─ + New layout → name it → Layout editor (blank floor)
  └─ each layout card:  [Edit layout]  [Seat guests ▶]

Layout editor  ── "Start seating ▶" ──▶  Live seating  ── "Edit layout" ──▶  Layout editor
```

## Run it

```bash
npm install      # once: downloads libraries into node_modules (like Maven/Gradle dependencies)
npm run dev      # starts a dev server; open the printed http://localhost:5173 link
npm run build    # type-checks everything and builds the production files into dist/
npm run lint     # style and correctness checks (similar to Checkstyle / SpotBugs)
```

The app needs your Supabase project's address and key. Copy `.env.example` to `.env.local` and fill them in
(Supabase dashboard → Project Settings → API). `.env.local` is in `.gitignore`, so it never gets committed.
Restart `npm run dev` after changing it. The one-time database setup is described in
[Setting up the database](#setting-up-the-database-once) below.

## Read the files in this order

1. **`src/types.ts`**: every data shape. The designer uses `RestaurantLayout`, `DesignTable`,
   `DesignFeature`, `DesignSection`; live seating uses `Table`, `Chair`, `Family`, `Reservation`, `EventState`.
2. **`src/App.tsx`**: login → restaurant → `RestaurantApp`, which switches between the three screens.
3. **`supabase/migrations/`**: the database tables, security rules and functions (read the comments at the top
   of each file).
4. **`src/state/remote.ts`**: every call to the database, and how rows become `RestaurantLayout` / `EventState`.
5. **`src/state/useLiveEvent.ts`**: how live seating loads, listens for changes and saves.
6. **`src/logic/designTables.ts`**: designer rules (seat limits, table types, copy/line-up helpers).
7. **`src/logic/liveLayout.ts`** and **`src/logic/seating.ts`**: live rules: open seats, table status, held tables.
8. Then the screens: `HomeScreen` → `LayoutEditor` (+ `EditorCanvas`) → `LiveSeatingScreen`
   (+ `LiveFloor`, `TableDetail`).

## Folder structure

```
supabase/migrations/       the database, as SQL (paste into the Supabase SQL Editor, in order)
  …_schema.sql             1. tables
  …_security.sql           2. Row Level Security: who may read / change what
  …_functions.sql          3. functions the app calls for every change (seat_family, save_layout, ...)
  …_realtime.sql           4. which tables send real-time updates
  …_corrections.sql        5. move a family, "Recent changes" log, table spot checks
  …_party_reservations.sql 6. "Back to reserved", and triggers that refuse walk-ins on reserved tables
  …_big_groups.sql         7. tables.group_id: a big group is held and seated as ONE party

src/
  types.ts                 data shapes (interfaces) shared by everything
  theme.ts                 colors used in the SVG drawings
  main.tsx                 entry point (like `public static void main`): mounts <App/> into index.html
  App.tsx                  login → restaurant → RestaurantApp
  App.css, index.css       styling

  lib/supabase.ts          the one shared connection to Supabase (reads .env.local)

  logic/                   pure functions: no React, no screen, no database, easy to test
    designTables.ts        designer rules: seat limits, table types, free spots, line up, copy
    liveLayout.ts          designed layout → live layout; which VIP / group tables are held
    seating.ts             live seat counts and table status
    suggest.ts             "Seat a party of 4": which table to suggest
    geometry.ts            where each chair is drawn around a table
    familyColors.ts        picks a distinct color for each new family

  state/
    remote.ts              all database calls (like a Java repository / DAO) + friendly error messages
    useRestaurantLayouts.ts loads the layouts, saves edits, reloads when another tablet changes them
    useLiveEvent.ts        joins the shared live seating, reloads on changes, sends each change
    useSession.ts          who is logged in
    connection.ts          online / offline (drives the "Offline · reconnecting…" banner)
    layoutStorage.ts       layout helpers: new layout, layout files, upgrading older data
    undoHistory.ts         undo / redo for the layout editor
    viewPrefs.ts           small per-tablet preferences (e.g. show sections)

  data/sampleLuauLayout.ts the sample luau floor plan ("Load sample luau layout" on the home menu)

  components/              one React component per file
    LoginScreen.tsx        email + password
    RestaurantSetup.tsx    first login: name the restaurant
    RestaurantApp.tsx      home menu ⇄ layout editor ⇄ live seating, for one restaurant
    ConnectionBanner.tsx   "Offline · reconnecting…" strip across the top
    HomeScreen.tsx         the menu of layouts (+ New layout, Edit layout, Seat guests, files, sample)
    NewLayoutDialog.tsx    "Name your restaurant"
    LayoutEditor.tsx       design screen: toolbar, panels, undo, many-select
    EditorCanvas.tsx       design floor: pan, pinch, tap, drag, hold-to-select
    NewTableDialog.tsx     "+ Table": type, shape, people, how many
    TablePanel / FeaturePanel / SectionPanel / SelectionPanel   side panels in the editor
    DesignTableShape.tsx   one table (design look, or live colors in live seating)
    DesignFeatureShape.tsx stage / divider / bar / buffet / entrance
    SectionOutline.tsx, SectionLabels.tsx, TableNameLabels.tsx   section tint and names on the floor
    LiveSeatingScreen.tsx  hostess screen: counter, reserve, clear, tap a table
    LiveFloor.tsx          live floor: pan, pinch, tap, double-tap (nothing can be moved)
    SeatCounter.tsx        "N seats open · M seated"
    PartySizeBar.tsx       "Seat a party of 1 2 3 …"
    TableDetail.tsx        full-screen view of one table with big tappable chairs
    Chair.tsx, ChairKindIcon.tsx, FamilyLegend.tsx, FamilyMenu.tsx,
    ReservationPanel.tsx, ReservationBar.tsx, ConfirmDialog.tsx, ZoomControls.tsx, FloorLegend.tsx
```

## Java → TypeScript/React cheat sheet

| Java | Here |
|---|---|
| `record Table(String id, ...)` | `interface Table { id: string; ... }` in `types.ts` |
| `enum Shape { CIRCLE, ... }` | `type TableShape = 'circle' \| 'square' \| 'rectangle'` |
| `List<Chair>` | `Chair[]` |
| `Map<String, Family>` | `Map<string, Family>` (same idea) |
| `Optional<Reservation>` | `Reservation \| undefined`, or `reservation?: Reservation` |
| `static int countSeats(...)` | `export function assignableEmptyChairs(...)` |
| `import com.x.Foo;` | `import Foo from './Foo'` |
| a class with a `render()` method | a **function component** that returns JSX (HTML-like markup) |
| constructor parameters | **props**, passed like HTML attributes: `<Chair color="red" />` |
| fields that change | **state**, declared with `useState` |
| listener interface (`onClick`) | a function passed down as a prop: `onTap={() => ...}` |
| `CompletableFuture<T>` | `Promise<T>`; `await` waits for it inside an `async` function |
| a DAO / repository class | `state/remote.ts` |

`const x = ...` is like `final var x = ...`. `(a, b) => a + b` is a lambda, as in Java.

## How data flows (live seating)

React data flows **one way: down**. Events flow **up**. The difference from a single-tablet app: the real
"source of truth" is no longer inside the app, it is the **database**. Each tablet shows a copy.

```
                         Supabase database  (the source of truth, shared by all tablets)
                           ▲ 1. rpc('seat_family')          │ 3. real-time: "event changed"
                           │                                ▼
              useLiveEvent (in LiveSeatingScreen.tsx)  ── 4. reload → event = { families, reservations }
                    │
     computes: statuses, open seats  (via logic/seating.ts + logic/liveLayout.ts)
                    │  props (data + callback functions)
       ┌────────────┼──────────────────────┐
  SeatCounter    LiveFloor              TableDetail
                  └─ DesignTableShape ×N   ├─ Chair ×N
                                           ├─ FamilyLegend / FamilyMenu
                                           └─ ReservationPanel
```

1. **The seating comes from the database.** `useLiveEvent(layout)` gives the screen the current `event`
   (all families and reservations) and a `run(action)` function to change it.
2. **Numbers are calculated, never stored.** On every render the screen runs the pure functions in
   `logic/seating.ts` to get each table's status and the counter values.
3. **Props go down.** The screen passes the data to `LiveFloor`, which passes one table's look to each
   `DesignTableShape`. A child never changes its props; they are read-only, like `final` parameters.
4. **Events go up as callbacks.** When you tap Done in `TableDetail`, it calls the
   `onCreateFamily(chairIds)` prop. The screen calls `run({ type: 'createFamily', ... })`.
5. **The database makes the change** (see the next section), and every tablet reloads and re-renders.

### Example: seating a family, step by step

1. Tap a table → `LiveFloor` detects a tap (not a drag) → calls `onTableTap("T7")`.
2. The screen sets `openTableId = "T7"` → `TableDetail` appears.
3. Tap three chairs → `TableDetail` keeps them in its own small state (`selected`). That is screen-only
   data: nobody else needs to know until you press Done.
4. Tap **Done** → `run({ type: 'createFamily', chairIds: ["T7-1","T7-2","T7-3"] })`
   → `remote.ts` calls the database function `seat_family`.
5. The database creates family `F1` → the app reloads the seating → the chairs turn the family's color.
   If the database said no (someone else just took a chair), a red message explains why instead.

## The backend: how Supabase, real-time and double-booking protection work

### What is Supabase?

**Supabase** is a hosted **PostgreSQL** database with extras: user logins (**Auth**), an automatic web API
for the database, and **Realtime** (it can tell connected apps the moment a row changes). There is no
server code of our own: the tablets talk to Supabase directly with the `@supabase/supabase-js` library,
through the one client in `src/lib/supabase.ts`.

If you know Java/JDBC: think of Supabase as the database **plus** the layer you would normally write in
Spring (login, REST endpoints, security), already built.

### The tables

```
restaurants ─┬─ staff_members  (which logins belong to this restaurant, with a role)
             └─ layouts ─┬─ sections, features (stage, divider…), tables ── chairs
                         └─ events  (one "live seating" session per layout)
                               ├─ families ── chair_assignments   (who sits on which chair)
                               ├─ reservations ── reservation_tables
                               └─ held_tables
```

They mirror `src/types.ts`. Two differences from the app's shapes:
- **`chairs` are real rows.** In the app, chairs are worked out from a table's seat count. In the database
  every chair is a row ("T7-3"), so an assignment can point at a chair that really exists.
  `save_layout` rebuilds them whenever a table's seats change.
- **`chair_assignments`** says "chair T7-3 belongs to family F1 in event X". A family's `chairIds` in the app
  are these rows.

### Who may see what: login and Row Level Security

- **Login** uses Supabase Auth with email + password (`LoginScreen.tsx`). Today the restaurant has **one
  shared staff account**: every tablet logs in with it. The table `staff_members` links a login to a
  restaurant with a `role` (`owner`, `manager`, `staff`), so later each person can get their own login:
  just add more rows, no table changes needed.
- **Row Level Security (RLS)** is switched on for **every** table. With RLS, Postgres checks a rule for
  each row before anyone may read or change it. Our rule everywhere: *you must be logged in and be staff of
  the restaurant this row belongs to* (see `…_security.sql`). Logged-out visitors get nothing.
  This is why it is safe that the publishable key is inside the app: the key only lets you *ask*;
  RLS decides what you get.

### How a seating change travels (online-first)

```
Tablet A                         Database                               Tablet B
tap Done ──rpc('seat_family')──▶ 1. lock this event's row
                                 2. check: table not reserved, chairs belong to the table
                                 3. insert family + chair_assignments
                                 4. events.version = version + 1
          ◀──── OK (F1) ───────  (all of 1–4 is one transaction)
reload seating                   Realtime: "events row changed" ─────▶ reload seating
chairs turn color                                                       chairs turn color
```

- **Every change is one database function** (`seat_family`, `finish_family`, `create_reservation`,
  `clear_table`, …; all in `…_functions.sql`). A function runs as **one transaction**: either all of it
  happens or none of it does.
- **Online-first:** the app never shows a change before the database accepted it. `useLiveEvent.run()` waits
  for the answer, then reloads. That is why a seat change takes a split second to appear, and why it can
  never "look saved" when it wasn't.
- **Offline:** `state/connection.ts` watches the browser's network status and the real-time connection.
  When either drops, the red **"Offline · reconnecting…"** strip appears and seating changes are refused
  with a message (nothing is half-saved). Supabase reconnects by itself; the app then reloads everything
  it missed. Layout edits are different: they stay on the tablet and are saved (and retried) when the
  connection is back.

### Real-time updates

Each tablet **subscribes** to one row: the live event's row in `events`
(`supabase.channel(...).on('postgres_changes', …)` in `useLiveEvent.ts`). Every seating function ends
with `version = version + 1` on that row, so every change, however big, sends **one** small signal. When
a tablet gets it, it reloads the whole seating with one call (`get_event_state`). Simple, and it can't
miss a change: even after a reconnect it just reloads.
The home menu works the same way with `restaurants.version` (layouts added, edited or deleted;
seating started or ended). The `version` number also stops a slow, older reply from overwriting a newer one.

### Double-booking protection

Two hostesses tap the same chair on two tablets at the same moment. Who gets it?

1. **The database decides, not the tablets.** The table `chair_assignments` has the primary key
   `(event_id, chair_id)`. A primary key must be unique, so Postgres itself refuses a second row for the
   same chair in the same event, no matter which app, tablet or bug tries to write it.
2. **One change at a time per event.** Each seating function starts by locking the event's row
   (`select … for update`). A second tablet's change waits a few milliseconds until the first is finished,
   then runs its checks against the new situation.
3. **A clear answer.** The function turns the "duplicate key" error into `chair_taken`. `remote.ts`
   translates that into *"Chair just taken on another tablet. The table has been refreshed."*, and the
   screen reloads that table so the hostess sees who got it and can pick other chairs.

Tables work the same way: `reservation_tables` allows only one **active** reservation per table and event,
so two tablets can't reserve the same table either. Two **triggers** (small functions Postgres runs on every
insert) close the last gap: a chair can't be assigned at a table that belongs to an active reservation, and a
table with guests can't be added to a reservation.

A reservation over several tables is **one party**: seating it (double-tap any of its tables, or **Seat party**),
**Back to reserved**, **Clear table** and **Release** each change the one reservation row, so every one of its
tables changes together on every tablet.

**Big groups** from the layout are parties too. Tables you make into a big group together share a `groupId`
(`DesignTable.groupId`, column `tables.group_id`). `heldGroups` in `logic/liveLayout.ts` turns each group into
one hold, and the database function `apply_holds` keeps exactly one reservation per group (merging holds that
were made table by table before, and adding tables that join the group later). On the floor, the group's name
is drawn once across its tables (`groupKey` in `TableNameLabels.tsx`).

### Fast corrections from a second device

A lead with a second tablet can fix the floor while the hostess keeps seating:

- **Move a family**: tap the family's color → **Move to another table** → tap the new table (only tables with
  enough open seats can be tapped) → **Move here**. Chairs side by side are already picked. The database
  function `move_family` does the whole move in one transaction (old chairs freed, new chairs taken), with the
  same event lock and `chair_assignments` key as seating, so a chair taken meanwhile gives "Chair just taken".
- **Quick edits** in the family menu: **− 1 seat / + 1 seat** (the closest free chair, so the family stays
  together) and **They left** (frees the chairs, still counts the guests).
- **Recent changes** (under the header): every seating function also writes a line to `event_changes`, e.g.
  "Family F12 moved P1 → P3". Each tablet sends a random **device id** with every request (header
  `x-device-id`, see `src/lib/device.ts`), so the list can say "this tablet" or "other device" even with one
  shared login, and the badge counts new changes from other devices. Tap a line to open that table.
- **Checked**: a button on each table that records in `table_checks` when someone last compared it with the
  real floor. The table then shows a small ✓, and its details say "checked 7:42 PM".

Nothing new is needed for real-time: every change still bumps `events.version`, and `get_event_state` now also
returns the 40 newest changes and the checks.

### Setting up the database (once)

1. In the Supabase dashboard, open **SQL Editor → New query**. Paste the whole contents of each file in
   `supabase/migrations/`, **in order** (`…01_schema`, `…02_security`, `…03_functions`, `…04_realtime`,
   `20261114000001_corrections`, `20261115000001_party_reservations`, `20261116000001_big_groups`), and press
   **Run** after each one.
2. **Authentication → Users → Add user**: create the restaurant's shared staff account (email + password,
   tick "Auto Confirm User").
3. Recommended: **Authentication → Sign In / Providers**: turn off "Allow new users to sign up", so only
   accounts you create can log in.
4. Start the app, log in with that account, and name the restaurant. Then tap **Load sample luau layout**
   (or **Copy … from this tablet** for layouts made before the database).

## The counter and held tables

- **N seats open** = empty chairs a walk-in could take (`assignableEmptyChairs` in `logic/seating.ts`).
  Chairs on held or reserved tables don't count.
- **VIP and Big group tables are held** for their party: when seating opens (and after layout edits), the app
  works out the groups (`heldGroups` in `logic/liveLayout.ts`) and the database function `sync_holds` makes a
  "held" reservation for each. Two tablets doing this at once can't create two holds (the event lock again).
  The hostess taps the table → **Seat party** (green) or **Release table** (open to walk-ins). Each table is
  held once per event (`held_tables`); **Clear all seating** starts fresh and holds them again.
- If you edit the layout during service, `save_layout` removes guests on tables or chairs that no longer exist.

## Things to try changing first

- Change family colors: `FAMILY_COLORS` in `src/logic/familyColors.ts`.
- Change when chairs appear on the floor: `SHOW_CHAIRS_SCALE` in `EditorCanvas.tsx` / `LiveFloor.tsx`.
- Change the table types' colors and names: `TABLE_KINDS` in `src/logic/designTables.ts`.
- Change an error message staff see: `MESSAGES` in `src/state/remote.ts`.
- Write your first unit test for `heldGroups` or `findFreeSpots`. They need no React and no database.
  (A test runner such as Vitest isn't installed yet.)
