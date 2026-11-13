// Saves live seating in the browser so a page refresh on the tablet doesn't lose it.
// Each restaurant layout keeps its own seating; the layout itself is saved by layoutStorage.ts.

import type { EventState } from '../types'
import { initialEventState } from './eventReducer'

const keyFor = (layoutId: string) => `seating-live-v1-${layoutId}`

export function loadEventState(layoutId: string): EventState {
  try {
    const raw = localStorage.getItem(keyFor(layoutId))
    if (!raw) return initialEventState
    const parsed = JSON.parse(raw) as Partial<EventState>
    if (!Array.isArray(parsed.families) || !Array.isArray(parsed.reservations)) return initialEventState
    return {
      families: parsed.families,
      reservations: parsed.reservations,
      nextFamilyNumber: parsed.nextFamilyNumber ?? parsed.families.length + 1,
      nextReservationNumber: parsed.nextReservationNumber ?? parsed.reservations.length + 1,
      heldTableIds: parsed.heldTableIds ?? [],
    }
  } catch {
    return initialEventState
  }
}

export function saveEventState(layoutId: string, state: EventState): void {
  try {
    localStorage.setItem(keyFor(layoutId), JSON.stringify(state))
  } catch {
    // Storage can be unavailable (private browsing). The app still works, it just won't survive a refresh.
  }
}

/** Forget a layout's seating (used when the layout itself is deleted). */
export function deleteEventState(layoutId: string): void {
  try {
    localStorage.removeItem(keyFor(layoutId))
  } catch {
    // ignore
  }
}
