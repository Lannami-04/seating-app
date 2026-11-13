// Pure seat-count and spare calculations.
// "Pure" means: the result depends only on the arguments, and nothing is modified.
// That makes every function here easy to unit test.

import type { Family, Layout, Reservation, Table } from '../types'

/** Families currently sitting (not done). */
export function activeFamilies(families: Family[]): Family[] {
  return families.filter((f) => f.status === 'seated')
}

/** Reservations that still own their tables (reserved or seated, not done). */
export function activeReservations(reservations: Reservation[]): Reservation[] {
  return reservations.filter((r) => r.status !== 'done')
}

/** Map from chair id to the family sitting there. */
export function chairOwners(families: Family[]): Map<string, Family> {
  const owners = new Map<string, Family>()
  for (const family of activeFamilies(families)) {
    for (const chairId of family.chairIds) owners.set(chairId, family)
  }
  return owners
}

/** The active reservation that owns this table, if any. */
export function reservationForTable(reservations: Reservation[], tableId: string): Reservation | undefined {
  return activeReservations(reservations).find((r) => r.tableIds.includes(tableId))
}

export interface TableStatus {
  /** Empty chairs a walk-in could take. Always 0 for reserved tables. */
  remaining: number
  /** Draw the table green: no assignable chairs left, or the reservation is seated. */
  isFull: boolean
  reservation?: Reservation
  families: Family[]
}

export function tableStatus(table: Table, families: Family[], reservations: Reservation[]): TableStatus {
  const reservation = reservationForTable(reservations, table.id)
  const atTable = activeFamilies(families).filter((f) => f.tableId === table.id)
  if (reservation) {
    return { remaining: 0, isFull: reservation.status === 'seated', reservation, families: atTable }
  }
  // Open = seats nobody sits on. A wheelchair-accessible seat is a normal seat (just marked as accessible),
  // so it counts. Highchairs are extras beside the table, so they don't.
  const takenIds = new Set(atTable.flatMap((f) => f.chairIds))
  const remaining = table.chairs.filter((c) => c.kind !== 'highchair' && !takenIds.has(c.id)).length
  return { remaining, isFull: remaining === 0, families: atTable }
}

export function tableStatuses(layout: Layout, families: Family[], reservations: Reservation[]): Map<string, TableStatus> {
  const result = new Map<string, TableStatus>()
  for (const table of layout.tables) result.set(table.id, tableStatus(table, families, reservations))
  return result
}

export function totalChairs(layout: Layout): number {
  return layout.tables.reduce((sum, t) => sum + t.chairs.filter((c) => c.kind !== 'highchair').length, 0)
}

/**
 * X in "X left": empty chairs a walk-in could still be given.
 * Chairs on reserved tables are excluded as soon as the reservation exists.
 */
export function assignableEmptyChairs(layout: Layout, families: Family[], reservations: Reservation[]): number {
  let count = 0
  for (const table of layout.tables) count += tableStatus(table, families, reservations).remaining
  return count
}

/**
 * Guests who have a seat or already came: every family (seated or done)
 * plus the party size of every reservation (reserved, seated or done).
 */
export function guestsAccountedFor(families: Family[], reservations: Reservation[]): number {
  const walkIns = families.reduce((sum, f) => sum + f.guestCount, 0)
  const parties = reservations.reduce((sum, r) => sum + r.partySize, 0)
  return walkIns + parties
}

/** A table can be reserved only when nobody sits there and no reservation owns it. */
export function canReserveTable(tableId: string, families: Family[], reservations: Reservation[]): boolean {
  if (reservationForTable(reservations, tableId)) return false
  return !activeFamilies(families).some((f) => f.tableId === tableId)
}
