# Learning the Seating App (a guide for Java developers)

This is a tablet app for restaurant seating. You **design** a restaurant's floor (tables, sections, stage,
dividers...), then switch to **live seating**, where the hostess taps a table and taps chairs to seat guests.
It is written in **TypeScript** (JavaScript with types, which will feel familiar from Java)
using **React** (a library for building screens out of components).

## How the app flows

```
Home menu ("My restaurants")
  ├─ + New layout → name it → Layout editor (blank floor)
  └─ each restaurant card:  [Edit layout]  [Seat guests ▶]

Layout editor  ── "Start seating ▶" ──▶  Live seating  ── "Edit layout" ──▶  Layout editor
```

## Run it

```bash
npm install      # once: downloads libraries into node_modules (like Maven/Gradle dependencies)
npm run dev      # starts a dev server; open the printed http://localhost:5173 link
npm run build    # type-checks everything and builds the production files into dist/
npm run lint     # style and correctness checks (similar to Checkstyle / SpotBugs)
```

## Read the files in this order

1. **`src/types.ts`**: every data shape. The designer uses `RestaurantLayout`, `DesignTable`,
   `DesignFeature`, `DesignSection`; live seating uses `Table`, `Chair`, `Family`, `Reservation`, `EventState`.
2. **`src/App.tsx`**: owns the list of layouts and switches between the three screens.
3. **`src/logic/designTables.ts`**: designer rules (seat limits, table types, copy/line-up helpers).
4. **`src/logic/liveLayout.ts`**: turns a designed layout into the live-seating shape; which tables are held.
5. **`src/logic/seating.ts`**: live rules: open seats, table status, whether a table is full.
6. **`src/state/eventReducer.ts`**: the only place where live seating changes (including `syncLayout`).
7. Then the screens: `HomeScreen` → `LayoutEditor` (+ `EditorCanvas`) → `LiveSeatingScreen`
   (+ `LiveFloor`, `TableDetail`).

## Folder structure

```
src/
  types.ts                 data shapes (interfaces) shared by everything
  theme.ts                 colors used in the SVG drawings
  main.tsx                 entry point (like `public static void main`): mounts <App/> into index.html
  App.tsx                  root component: home menu ⇄ layout editor ⇄ live seating
  App.css, index.css       styling

  logic/                   pure functions: no React, no screen, easy to test
    designTables.ts        designer rules: seat limits, table types, free spots, line up, copy
    liveLayout.ts          designed layout → live layout; held VIP/group tables; per-section counts
    seating.ts             live seat counts and table status
    geometry.ts            where each chair is drawn around a table
    familyColors.ts        picks a distinct color for each new family

  state/
    layoutStorage.ts       saves/loads the designed layouts
    storage.ts             saves/loads live seating, one per layout
    eventReducer.ts        all the ways live seating can change ("actions")
    undoHistory.ts         undo / redo for the layout editor

  components/              one React component per file
    HomeScreen.tsx         the menu of restaurants (+ New layout, Edit layout, Seat guests)
    NewLayoutDialog.tsx    "Name your restaurant"
    LayoutEditor.tsx       design screen: toolbar, panels, undo, many-select
    EditorCanvas.tsx       design floor: pan, pinch, tap, drag, hold-to-select
    NewTableDialog.tsx     "+ Table": type, shape, people, how many
    TablePanel / FeaturePanel / SectionPanel / SelectionPanel   side panels in the editor
    DesignTableShape.tsx   one table (design look, or live colors in live seating)
    DesignFeatureShape.tsx stage / divider / bar / buffet / entrance
    SectionOutline.tsx     colored area + name tag around a section's tables
    LiveSeatingScreen.tsx  hostess screen: counter, reserve, clear, tap a table
    LiveFloor.tsx          live floor: pan, pinch, tap (nothing can be moved)
    SeatCounter.tsx        "N seats open · M seated" + per-section chips
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
| fields that change | **state**, declared with `useState` or `useReducer` |
| listener interface (`onClick`) | a function passed down as a prop: `onTap={() => ...}` |

`const x = ...` is like `final var x = ...`. `(a, b) => a + b` is a lambda, as in Java.

## How data flows (live seating)

React data flows **one way: down**. Events flow **up**.

```
              LiveSeatingScreen.tsx
     state: event = { families, reservations }   ← the single source of truth (per layout)
                    │
     computes: statuses, open seats  (via logic/seating.ts + logic/liveLayout.ts)
                    │  props (data + callback functions)
       ┌────────────┼──────────────────────┐
  SeatCounter    LiveFloor              TableDetail
                  └─ DesignTableShape ×N   ├─ Chair ×N
                                           ├─ FamilyLegend / FamilyMenu
                                           └─ ReservationPanel
```

1. **State lives in one place.** `LiveSeatingScreen` calls `useReducer(eventReducer, ...)`. It gets back the current
   `event` (all families and reservations) and a `dispatch` function.
2. **Numbers are calculated, never stored.** On every render the screen runs the pure functions in
   `logic/seating.ts` to get each table's status and the counter values. Because they are always
   recalculated, they can never get out of sync.
3. **Props go down.** The screen passes the data to `LiveFloor`, which passes one table's look to each
   `DesignTableShape`. A child never changes its props; they are read-only, like `final` parameters.
4. **Events go up as callbacks.** When you tap Done in `TableDetail`, it calls the
   `onCreateFamily(chairIds)` prop. The screen handles that by calling
   `dispatch({ type: 'createFamily', ... })`.
5. **The reducer makes the change.** `eventReducer(oldState, action)` returns a **new** state object.
   It never modifies the old one: it makes copies with `{ ...state, families: [...] }`.
   React sees the new object and re-renders, so the table turns green and the counter updates.
6. **Saving.** A `useEffect` in the screen writes the new state to the browser's `localStorage` after every
   change, so refreshing the tablet doesn't lose the seating.

### Example: seating a family, step by step

1. Tap a table → `LiveFloor` detects a tap (not a drag) → calls `onTableTap("T7")`.
2. The screen sets `openTableId = "T7"` → `TableDetail` appears.
3. Tap three chairs → `TableDetail` keeps them in its own small state (`selected`). That is screen-only
   data, so it doesn't need to live in the screen.
4. Tap **Done** → `onCreateFamily(["T7-1","T7-2","T7-3"])` → the screen dispatches `createFamily`.
5. The reducer creates family `F1` with the next free color → new state → everything re-renders.

## The counter and held tables

- **N seats open** = empty chairs a walk-in could take (`assignableEmptyChairs` in `logic/seating.ts`).
  Chairs on held or reserved tables don't count.
- **VIP and Big group tables are held** for their party: when seating opens, `syncLayout` in
  `eventReducer.ts` makes a "held" reservation for them. The hostess taps the table → **Seat party**
  (green) or **Release table** (open to walk-ins). Each table is held once per night
  (`heldTableIds`); **Clear all seating** starts a fresh night and holds them again.
- If you edit the layout during service, `syncLayout` drops guests on tables or chairs that no longer exist.

## Things to try changing first

- Change family colors: `FAMILY_COLORS` in `src/logic/familyColors.ts`.
- Change when chairs appear on the floor: `SHOW_CHAIRS_SCALE` in `EditorCanvas.tsx` / `LiveFloor.tsx`.
- Change the table types' colors and names: `TABLE_KINDS` in `src/logic/designTables.ts`.
- Write your first unit test for `syncLayout` or `findFreeSpots`. They need no React at all.
  (A test runner such as Vitest isn't installed yet.)
