// All the data shapes used by the app live here.
// In Java terms: these are like plain data classes / records with no methods.
// `interface` describes the shape of an object; `type X = 'a' | 'b'` is like a small enum.

export type TableShape = 'circle' | 'square' | 'rectangle'

/**
 * 'wheelchair': a normal seat marked as wheelchair accessible (still counts, anyone may use it).
 * 'highchair': an extra spot added beside the table; it doesn't use up a seat.
 */
export type ChairKind = 'standard' | 'wheelchair' | 'highchair'

export interface Chair {
  /** Unique across the whole layout, e.g. "T12-3" = table T12, chair 3. */
  id: string
  tableId: string
  /** 1-based seat number at the table. */
  number: number
  kind: ChairKind
}

export interface Table {
  /** e.g. "T12". */
  id: string
  /** Short name staff use, e.g. "P4" (Plumeria section, table 4). */
  name: string
  sectionId: string
  shape: TableShape
  /** Center of the table on the floor plan, in layout units (roughly feet). */
  x: number
  y: number
  chairs: Chair[]
}

export interface Section {
  id: string
  name: string
  /** Where the section's name is drawn on the floor plan. */
  labelX: number
  labelY: number
}

/** Non-table things drawn on the floor plan: stage, bar, buffet. */
export interface Feature {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface Layout {
  width: number
  height: number
  sections: Section[]
  tables: Table[]
  features: Feature[]
}

/** A group of walk-in guests sitting together at one table. */
export interface Family {
  /** Automatic id, e.g. "F7". */
  id: string
  tableId: string
  /** Chairs this family occupies. Empty once the family is done. */
  chairIds: string[]
  /** CSS color used for this family's chairs. */
  color: string
  /** 'done' = they left; chairs are free again but they still count as guests who came. */
  status: 'seated' | 'done'
  guestCount: number
  createdAt: number
}

/** A named party that owns one or more whole tables. */
export interface Reservation {
  /** Automatic id, e.g. "R3". */
  id: string
  name: string
  tableIds: string[]
  /** Number of guests in the party (may be less than the seats on its tables). */
  partySize: number
  /** 'done' = the party left and its tables are free again. */
  status: 'reserved' | 'seated' | 'done'
  createdAt: number
  /** True when made automatically from a VIP / Big group table in the layout (it can be "released"). */
  held?: boolean
}

/** Everything that changes during service (stored separately for each restaurant layout). */
export interface EventState {
  families: Family[]
  reservations: Reservation[]
  nextFamilyNumber: number
  nextReservationNumber: number
  /**
   * VIP / Big group tables that already got their automatic hold this service.
   * Remembered so a hold the hostess released (or a party that left) isn't put back.
   */
  heldTableIds: string[]
}

// ---------- Restaurant designer (home menu + blank canvas) ----------

/** Regular tables show their seat count; VIP tables show the guest's name; big groups are for large parties. */
export type TableKind = 'regular' | 'vip' | 'group'

/** A table the user placed on their own restaurant canvas. */
export interface DesignTable {
  id: string
  /** Label shown on the table, e.g. "T3". */
  name: string
  shape: TableShape
  kind: TableKind
  /** VIP guest or group name shown in the middle of the table (empty for regular tables). */
  guestName: string
  /** Center of the table on the canvas, in layout units (roughly feet). */
  x: number
  y: number
  /** Turn angle in degrees, clockwise (0 = as first placed, 90 = standing vertical). */
  rotation: number
  seats: number
  /** Wheelchair spots by position: chairKinds[0] is seat 1. Missing entries are standard chairs. */
  chairKinds: ChairKind[]
  /** Extra highchairs added beside the table. They don't use up any of its seats. */
  highchairs: number
  /** The section (e.g. "Hibiscus") this table belongs to, if any. */
  sectionId: string | null
  /**
   * Big group tables that were made into a group together share this id: during service they are ONE
   * party (one reservation, one name across them, seated together). Null / missing for other tables.
   */
  groupId?: string | null
}

/** Things on the floor that are not tables. */
export type FeatureKind = 'stage' | 'divider' | 'bar' | 'buffet' | 'entrance'

export interface DesignFeature {
  id: string
  kind: FeatureKind
  /** Text drawn on it, e.g. "Stage". */
  label: string
  /** Center position and size, in layout units. */
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** A named group of tables, e.g. "Hibiscus". */
export interface DesignSection {
  id: string
  name: string
  color: string
}

/** One restaurant layout the user created from the home menu. */
export interface RestaurantLayout {
  id: string
  name: string
  /** Canvas size in layout units. */
  width: number
  height: number
  tables: DesignTable[]
  features: DesignFeature[]
  sections: DesignSection[]
  createdAt: number
  updatedAt: number
}
