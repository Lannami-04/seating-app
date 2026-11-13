// Everything that talks to the Supabase database lives here (like a "repository" / DAO in Java).
// The rest of the app works with the same shapes as before (RestaurantLayout, EventState);
// this file turns database rows into those shapes and back.

import type { ChairKind, DesignFeature, DesignSection, DesignTable, EventState, Family, Reservation, RestaurantLayout } from '../types'
import { supabase } from '../lib/supabase'
import { heldGroups } from '../logic/liveLayout'
import { activeFamilies } from '../logic/seating'
import { pickFamilyColor } from '../logic/familyColors'

function db() {
  if (!supabase) throw new RemoteError('not_configured', 'The app is not connected to a database (missing .env.local).')
  return supabase
}

// ---------- Errors ----------

/** Messages for the error codes raised by the database functions (see supabase/migrations/…_functions.sql). */
const MESSAGES: Record<string, string> = {
  chair_taken: 'Chair just taken on another tablet. The table has been refreshed.',
  table_taken: 'That table was just taken on another tablet. The floor has been refreshed.',
  table_reserved: 'That table was just reserved on another tablet. The floor has been refreshed.',
  event_ended: 'Live seating was ended on another tablet.',
  family_not_found: 'That family was just changed on another tablet. The table has been refreshed.',
  chair_not_found: 'That chair no longer exists (the layout was just changed). The table has been refreshed.',
  table_not_found: 'That table no longer exists (the layout was just changed).',
  not_allowed: "This login doesn't have access to that restaurant.",
  network: "Couldn't reach the server, so nothing was saved. Check the Wi-Fi and try again.",
}

export class RemoteError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Turns any error from Supabase (or the network) into a RemoteError with a message staff can understand. */
export function toRemoteError(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
  const code = Object.keys(MESSAGES).find((c) => message.includes(c))
  if (code) return new RemoteError(code, MESSAGES[code])
  if (/fetch|network|load failed|timeout/i.test(message)) return new RemoteError('network', MESSAGES.network)
  return new RemoteError('other', `Something went wrong: ${message}`)
}

/** Supabase calls return { data, error } instead of throwing; this throws so callers can use try/catch. */
function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw toRemoteError(result.error)
  return result.data
}

// ---------- Restaurant (who am I working for?) ----------

export interface Restaurant {
  id: string
  name: string
  /** 'owner' | 'manager' | 'staff' (for individual staff accounts later). */
  role: string
}

/** The restaurant this login belongs to, or null if it has none yet (first login). */
export async function fetchMyRestaurant(userId: string): Promise<Restaurant | null> {
  const rows = unwrap(
    await db().from('staff_members').select('role, restaurants(id, name)').eq('user_id', userId).limit(1),
  ) as unknown as { role: string; restaurants: { id: string; name: string } | null }[]
  const row = rows[0]
  return row?.restaurants ? { id: row.restaurants.id, name: row.restaurants.name, role: row.role } : null
}

export async function createRestaurant(name: string): Promise<string> {
  return unwrap(await db().rpc('create_restaurant', { p_name: name })) as string
}

// ---------- Layouts ----------

const LAYOUT_COLUMNS =
  'id, name, width, height, created_at, updated_at, ' +
  'sections(id, name, color, position), ' +
  'features(id, kind, label, x, y, width, height, rotation, position), ' +
  'tables(id, name, shape, kind, guest_name, x, y, rotation, seats, chair_kinds, highchairs, section_id, position)'

interface LayoutRow {
  id: string
  name: string
  width: number
  height: number
  created_at: string
  updated_at: string
  sections: (DesignSection & { position: number })[]
  features: (DesignFeature & { position: number })[]
  tables: {
    id: string
    name: string
    shape: DesignTable['shape']
    kind: DesignTable['kind']
    guest_name: string
    x: number
    y: number
    rotation: number
    seats: number
    chair_kinds: (ChairKind | null)[]
    highchairs: number
    section_id: string | null
    position: number
  }[]
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

function layoutFromRow(row: LayoutRow): RestaurantLayout {
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    sections: [...row.sections].sort(byPosition).map(({ id, name, color }) => ({ id, name, color })),
    features: [...row.features].sort(byPosition).map(({ id, kind, label, x, y, width, height, rotation }) => ({ id, kind, label, x, y, width, height, rotation })),
    tables: [...row.tables].sort(byPosition).map((t) => ({
      id: t.id,
      name: t.name,
      shape: t.shape,
      kind: t.kind,
      guestName: t.guest_name,
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      seats: t.seats,
      chairKinds: t.chair_kinds.map((k) => k ?? 'standard'),
      highchairs: t.highchairs,
      sectionId: t.section_id,
    })),
  }
}

export async function fetchLayouts(restaurantId: string): Promise<RestaurantLayout[]> {
  const rows = unwrap(await db().from('layouts').select(LAYOUT_COLUMNS).eq('restaurant_id', restaurantId))
  return (rows as unknown as LayoutRow[]).map(layoutFromRow)
}

/** Creates or replaces the whole layout (tables, chairs, sections, room items) in one transaction. */
export async function saveLayout(restaurantId: string, layout: RestaurantLayout): Promise<void> {
  unwrap(await db().rpc('save_layout', { p_restaurant: restaurantId, p_layout: layout }))
}

export async function deleteLayout(layoutId: string): Promise<void> {
  unwrap(await db().rpc('delete_layout', { p_layout: layoutId }))
}

// ---------- Live seating ----------

/** Layout id → its live event and how many guests sit there now. */
export type LiveEvents = Map<string, { eventId: string; guestsSeated: number }>

export async function fetchLiveEvents(restaurantId: string): Promise<LiveEvents> {
  const rows = unwrap(await db().rpc('live_events', { p_restaurant: restaurantId })) as {
    layout_id: string
    event_id: string
    guests_seated: number
  }[]
  return new Map(rows.map((r) => [r.layout_id, { eventId: r.event_id, guestsSeated: r.guests_seated }]))
}

/** Joins the layout's live event (every tablet gets the same one), or starts it. */
export async function startEvent(layoutId: string): Promise<string> {
  return unwrap(await db().rpc('start_event', { p_layout: layoutId })) as string
}

export async function endEvent(eventId: string): Promise<void> {
  unwrap(await db().rpc('end_event', { p_event: eventId }))
}

/** The seating as the app knows it, plus what the database adds: a version number and whether it ended. */
export interface RemoteEventState extends EventState {
  version: number
  ended: boolean
}

export async function fetchEventState(eventId: string): Promise<RemoteEventState> {
  const s = unwrap(await db().rpc('get_event_state', { p_event: eventId })) as {
    version: number
    ended: boolean
    nextFamilyNumber: number
    nextReservationNumber: number
    families: Family[]
    reservations: Reservation[]
    heldTableIds: string[]
  } | null
  if (!s) throw new RemoteError('event_ended', MESSAGES.event_ended)
  return { ...s, reservations: s.reservations.map((r) => (r.held ? r : { ...r, held: undefined })) }
}

/** Holds VIP / big-group tables for their party (safe to call from several tablets at once). */
export async function syncHolds(eventId: string, layout: RestaurantLayout): Promise<void> {
  unwrap(await db().rpc('sync_holds', { p_event: eventId, p_groups: heldGroups(layout) }))
}

/** Every change the hostess can make during service. Each one becomes one database function call. */
export type LiveAction =
  | { type: 'createFamily'; tableId: string; chairIds: string[] }
  | { type: 'updateFamilyChairs'; familyId: string; chairIds: string[] }
  | { type: 'markFamilyDone'; familyId: string }
  | { type: 'removeFamily'; familyId: string }
  | { type: 'createReservation'; name: string; partySize: number; tableIds: string[] }
  | { type: 'seatReservation'; reservationId: string }
  | { type: 'cancelReservation'; reservationId: string }
  | { type: 'clearTable'; tableId: string }
  | { type: 'resetEvent'; layout: RestaurantLayout }

/**
 * Sends one seating change to the database. Resolves with the new family / reservation id when one
 * was created. Rejects with a RemoteError (e.g. code 'chair_taken') if the database refused it.
 */
export async function runLiveAction(eventId: string, action: LiveAction, current: EventState): Promise<string | null> {
  const p_event = eventId
  switch (action.type) {
    case 'createFamily': {
      const atTable = activeFamilies(current.families).filter((f) => f.tableId === action.tableId)
      const p_color = pickFamilyColor(atTable)
      return unwrap(await db().rpc('seat_family', { p_event, p_table: action.tableId, p_chairs: action.chairIds, p_color })) as string
    }
    case 'updateFamilyChairs':
      unwrap(await db().rpc('update_family_chairs', { p_event, p_family: action.familyId, p_chairs: action.chairIds }))
      return null
    case 'markFamilyDone':
      unwrap(await db().rpc('finish_family', { p_event, p_family: action.familyId }))
      return null
    case 'removeFamily':
      unwrap(await db().rpc('remove_family', { p_event, p_family: action.familyId }))
      return null
    case 'createReservation':
      return unwrap(
        await db().rpc('create_reservation', { p_event, p_name: action.name, p_party_size: action.partySize, p_tables: action.tableIds }),
      ) as string
    case 'seatReservation':
      unwrap(await db().rpc('seat_reservation', { p_event, p_reservation: action.reservationId }))
      return null
    case 'cancelReservation':
      unwrap(await db().rpc('cancel_reservation', { p_event, p_reservation: action.reservationId }))
      return null
    case 'clearTable':
      unwrap(await db().rpc('clear_table', { p_event, p_table: action.tableId }))
      return null
    case 'resetEvent':
      unwrap(await db().rpc('reset_event', { p_event, p_groups: heldGroups(action.layout) }))
      return null
  }
}
