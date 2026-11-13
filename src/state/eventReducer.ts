// The one place where event state changes.
// A reducer is a pure function: (old state, action) -> new state.
// Components never modify state directly; they "dispatch" an action describing what happened.
// Timestamps are passed in (`now`) so the reducer stays pure and testable.

import type { EventState, Family, Reservation, RestaurantLayout } from '../types'
import { activeFamilies, chairOwners, reservationForTable } from '../logic/seating'
import { heldGroups } from '../logic/liveLayout'
import { pickFamilyColor } from '../logic/familyColors'

export type EventAction =
  | { type: 'createFamily'; tableId: string; chairIds: string[]; now: number }
  | { type: 'updateFamilyChairs'; familyId: string; chairIds: string[] }
  | { type: 'markFamilyDone'; familyId: string }
  | { type: 'removeFamily'; familyId: string }
  | { type: 'createReservation'; name: string; partySize: number; tableIds: string[]; now: number }
  | { type: 'seatReservation'; reservationId: string }
  | { type: 'cancelReservation'; reservationId: string }
  | { type: 'clearTable'; tableId: string }
  | { type: 'resetEvent' }
  /** The layout may have changed (or seating just opened): tidy up and hold VIP / group tables. */
  | { type: 'syncLayout'; layout: RestaurantLayout; now: number }

export const initialEventState: EventState = {
  families: [],
  reservations: [],
  nextFamilyNumber: 1,
  nextReservationNumber: 1,
  heldTableIds: [],
}

/** True if every chair is free (or already belongs to `allowedFamilyId`). */
function chairsAreFree(state: EventState, chairIds: string[], allowedFamilyId?: string): boolean {
  const owners = chairOwners(state.families)
  return chairIds.every((id) => {
    const owner = owners.get(id)
    return !owner || owner.id === allowedFamilyId
  })
}

export function eventReducer(state: EventState, action: EventAction): EventState {
  switch (action.type) {
    case 'createFamily': {
      if (action.chairIds.length === 0) return state
      if (reservationForTable(state.reservations, action.tableId)) return state
      if (!chairsAreFree(state, action.chairIds)) return state
      const atTable = activeFamilies(state.families).filter((f) => f.tableId === action.tableId)
      const family: Family = {
        id: `F${state.nextFamilyNumber}`,
        tableId: action.tableId,
        chairIds: [...action.chairIds],
        color: pickFamilyColor(atTable),
        status: 'seated',
        guestCount: action.chairIds.length,
        createdAt: action.now,
      }
      return { ...state, families: [...state.families, family], nextFamilyNumber: state.nextFamilyNumber + 1 }
    }

    case 'updateFamilyChairs': {
      if (action.chairIds.length === 0) return state
      if (!chairsAreFree(state, action.chairIds, action.familyId)) return state
      return {
        ...state,
        families: state.families.map((f) =>
          f.id === action.familyId ? { ...f, chairIds: [...action.chairIds], guestCount: action.chairIds.length } : f,
        ),
      }
    }

    case 'markFamilyDone':
      return {
        ...state,
        families: state.families.map((f) => (f.id === action.familyId ? { ...f, status: 'done', chairIds: [] } : f)),
      }

    case 'removeFamily':
      return { ...state, families: state.families.filter((f) => f.id !== action.familyId) }

    case 'createReservation': {
      const name = action.name.trim()
      if (!name || action.tableIds.length === 0 || action.partySize < 1) return state
      const owners = chairOwners(state.families)
      const blocked = action.tableIds.some(
        (tableId) =>
          reservationForTable(state.reservations, tableId) ||
          [...owners.values()].some((f) => f.tableId === tableId),
      )
      if (blocked) return state
      const reservation: Reservation = {
        id: `R${state.nextReservationNumber}`,
        name,
        tableIds: [...action.tableIds],
        partySize: action.partySize,
        status: 'reserved',
        createdAt: action.now,
      }
      return {
        ...state,
        reservations: [...state.reservations, reservation],
        nextReservationNumber: state.nextReservationNumber + 1,
      }
    }

    case 'seatReservation':
      return {
        ...state,
        reservations: state.reservations.map((r) =>
          r.id === action.reservationId && r.status === 'reserved' ? { ...r, status: 'seated' } : r,
        ),
      }

    case 'cancelReservation':
      return { ...state, reservations: state.reservations.filter((r) => r.id !== action.reservationId) }

    case 'clearTable': {
      // Families at the table are marked done (they came, so they still count as guests).
      // A reservation that was never seated is cancelled; a seated one is marked done,
      // which frees all of its tables.
      const reservation = reservationForTable(state.reservations, action.tableId)
      const families = state.families.map((f) =>
        f.tableId === action.tableId && f.status === 'seated' ? { ...f, status: 'done' as const, chairIds: [] } : f,
      )
      let reservations = state.reservations
      if (reservation?.status === 'reserved') {
        reservations = reservations.filter((r) => r.id !== reservation.id)
      } else if (reservation?.status === 'seated') {
        reservations = reservations.map((r) => (r.id === reservation.id ? { ...r, status: 'done' as const } : r))
      }
      return { ...state, families, reservations }
    }

    case 'resetEvent':
      return initialEventState

    case 'syncLayout':
      return syncLayout(state, action.layout, action.now)
  }
}

/**
 * Brings the seating in line with the (possibly edited) layout:
 * 1. guests on tables or chairs that no longer exist are dropped,
 * 2. deleted tables are removed from reservations (a reservation left with no tables goes away),
 * 3. VIP / Big group tables that haven't been held yet this service get a "held" reservation,
 * 4. held reservations not yet seated pick up name / size changes made in the layout.
 */
function syncLayout(state: EventState, layout: RestaurantLayout, now: number): EventState {
  const seatsByTable = new Map(layout.tables.map((t) => [t.id, t.seats]))
  const highchairsByTable = new Map(layout.tables.map((t) => [t.id, t.highchairs ?? 0]))
  // Chair ids look like "<tableId>-<number>", highchairs "<tableId>-h<number>" (see toTable in logic/designTables.ts).
  const chairExists = (chairId: string, tableId: string) => {
    const seats = seatsByTable.get(tableId)
    if (seats === undefined) return false
    const rest = chairId.slice(tableId.length + 1)
    if (rest.startsWith('h')) {
      const k = Number(rest.slice(1))
      return k >= 1 && k <= (highchairsByTable.get(tableId) ?? 0)
    }
    const n = Number(rest)
    return n >= 1 && n <= seats
  }

  let families = state.families
    .filter((f) => seatsByTable.has(f.tableId))
    .map((f) => {
      const chairIds = f.chairIds.filter((c) => chairExists(c, f.tableId))
      return chairIds.length === f.chairIds.length ? f : { ...f, chairIds }
    })
  // A seated family that lost all its chairs is gone from the floor.
  families = families.filter((f) => f.status !== 'seated' || f.chairIds.length > 0)

  let reservations = state.reservations
    .map((r) => {
      const tableIds = r.tableIds.filter((id) => seatsByTable.has(id))
      return tableIds.length === r.tableIds.length ? r : { ...r, tableIds }
    })
    .filter((r) => r.tableIds.length > 0)

  const heldTableIds = state.heldTableIds.filter((id) => seatsByTable.has(id))
  let nextReservationNumber = state.nextReservationNumber
  const busy = (tableId: string) =>
    reservationForTable(reservations, tableId) !== undefined || activeFamilies(families).some((f) => f.tableId === tableId)

  for (const group of heldGroups(layout)) {
    const existing = reservations.find((r) => r.held && r.status === 'reserved' && group.tableIds.some((id) => r.tableIds.includes(id)))
    if (existing) {
      // Still waiting for the party: keep its name and size in step with the layout.
      if (existing.name !== group.name || existing.partySize !== group.partySize) {
        reservations = reservations.map((r) => (r.id === existing.id ? { ...r, name: group.name, partySize: group.partySize } : r))
      }
      continue
    }
    const fresh = group.tableIds.filter((id) => !heldTableIds.includes(id) && !busy(id))
    if (fresh.length === 0) continue
    reservations = [
      ...reservations,
      {
        id: `R${nextReservationNumber}`,
        name: group.name,
        tableIds: fresh,
        partySize: group.partySize,
        status: 'reserved',
        createdAt: now,
        held: true,
      },
    ]
    nextReservationNumber += 1
    heldTableIds.push(...fresh)
  }

  return { ...state, families, reservations, heldTableIds, nextReservationNumber }
}
