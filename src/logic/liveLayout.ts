// Turns a designed restaurant layout into what the live seating logic works with. Plain functions, no UI.

import type { EventState, Layout, RestaurantLayout } from '../types'
import { activeFamilies } from './seating'
import { groupBox, toTable, DESIGN_CHAIR_RADIUS } from './designTables'

/** The designed layout in the shape `logic/seating.ts` expects (tables with chair lists). */
export function toLiveLayout(layout: RestaurantLayout): Layout {
  return {
    width: layout.width,
    height: layout.height,
    tables: layout.tables.map(toTable),
    sections: layout.sections.map((s) => {
      const box = groupBox(
        layout.tables.filter((t) => t.sectionId === s.id),
        DESIGN_CHAIR_RADIUS,
        0,
      )
      return { id: s.id, name: s.name, labelX: box?.minX ?? 0, labelY: box?.minY ?? 0 }
    }),
    features: layout.features.map((f) => ({
      id: f.id,
      label: f.label,
      x: f.x - f.width / 2,
      y: f.y - f.height / 2,
      width: f.width,
      height: f.height,
    })),
  }
}

export interface HeldGroup {
  name: string
  tableIds: string[]
  partySize: number
}

/**
 * VIP and Big group tables are held for their party during service.
 * - Big group tables made into a group together (same groupId) are ONE party, named or not.
 * - Otherwise tables with the same name form one party (e.g. two VIP tables for "Mayor Kealoha");
 *   an unnamed table is held on its own.
 */
export function heldGroups(layout: RestaurantLayout): HeldGroup[] {
  const groups = new Map<string, HeldGroup>()
  for (const t of layout.tables) {
    if (t.kind === 'regular') continue
    const name = t.guestName.trim()
    const key =
      t.kind === 'group' && t.groupId ? `grp:${t.groupId}` : name ? `${t.kind}:${name.toLowerCase()}` : `table:${t.id}`
    const g = groups.get(key) ?? { name: '', tableIds: [], partySize: 0 }
    // The party's name: the first name found on any of its tables.
    if (!g.name && name) g.name = name
    g.tableIds.push(t.id)
    g.partySize += t.seats
    groups.set(key, g)
  }
  for (const [key, g] of groups) {
    if (g.name) continue
    const first = layout.tables.find((t) => t.id === g.tableIds[0])
    const names = g.tableIds.map((id) => layout.tables.find((t) => t.id === id)?.name ?? id)
    g.name = key.startsWith('vip:') || first?.kind === 'vip' ? 'VIP' : `Big group ${names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names[0]}`
  }
  return [...groups.values()]
}

/** Tables with guests sitting or a party seated right now. */
export function occupiedTableIds(event: EventState): Set<string> {
  const ids = new Set(activeFamilies(event.families).map((f) => f.tableId))
  for (const r of event.reservations) if (r.status === 'seated') r.tableIds.forEach((id) => ids.add(id))
  return ids
}

/** Guests sitting right now (walk-in families + seated parties). */
export function guestsSeated(event: EventState): number {
  const walkIns = activeFamilies(event.families).reduce((sum, f) => sum + f.guestCount, 0)
  const parties = event.reservations.filter((r) => r.status === 'seated').reduce((sum, r) => sum + r.partySize, 0)
  return walkIns + parties
}
