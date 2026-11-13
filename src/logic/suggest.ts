// "Where should this party sit?" Plain functions, no UI.

import type { Family, RestaurantLayout, Table } from '../types'
import type { TableStatus } from './seating'
import { featureBox } from './designTables'

export interface Suggestion {
  tableId: string
  /** Short reason shown to the hostess, e.g. "fills it up". */
  reason: string
}

/** Distance from a table to the nearest stage (or to the top of the floor if there's no stage). */
function stageDistance(layout: RestaurantLayout, x: number, y: number): number {
  const stages = layout.features.filter((f) => f.kind === 'stage').map(featureBox)
  if (stages.length === 0) return y
  return Math.min(
    ...stages.map((b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY))),
  )
}

/**
 * The best table for a party of `size`, by the house rules, in order:
 * 1. a table the party fills up exactly (no empty seats left),
 * 2. a table that already has guests (finish tables before starting new ones),
 * 3. closest to the stage first, working back,
 * 4. fewest empty seats left over.
 * Held / reserved tables are never suggested. Null if no single table has enough open seats.
 */
export function suggestTable(
  layout: RestaurantLayout,
  statuses: Map<string, TableStatus>,
  size: number,
): Suggestion | null {
  const candidates = layout.tables
    .map((t) => ({ t, s: statuses.get(t.id) }))
    .filter(({ s }) => s && !s.reservation && s.remaining >= size)
    .map(({ t, s }) => {
      const status = s as TableStatus
      return {
        id: t.id,
        fills: status.remaining === size,
        started: status.families.length > 0,
        stage: stageDistance(layout, t.x, t.y),
        leftover: status.remaining - size,
      }
    })
  if (candidates.length === 0) return null

  candidates.sort(
    (a, b) =>
      Number(b.fills) - Number(a.fills) ||
      Number(b.started) - Number(a.started) ||
      a.stage - b.stage ||
      a.leftover - b.leftover,
  )
  const best = candidates[0]
  const reason = best.fills
    ? 'fills it up'
    : best.started
      ? `joins a table · ${best.leftover} left after`
      : `closest open table · ${best.leftover} left after`
  return { tableId: best.id, reason }
}

/**
 * Which empty chairs to pre-select for a party of `size`: side by side if possible
 * (chairs are numbered around the table), otherwise the first free ones.
 */
export function chairsForParty(table: Table, owners: Map<string, Family>, size: number): string[] {
  // All real seats (highchairs are picked by hand). Wheelchair-accessible seats are normal seats, but they're
  // used last so they stay free for a wheelchair guest whenever possible.
  const seats = table.chairs.filter((c) => c.kind !== 'highchair')
  const ids = seats.map((c) => c.id)
  const free = ids.map((id) => !owners.has(id))
  const accessible = seats.map((c) => c.kind === 'wheelchair')
  const n = ids.length
  let best: string[] | null = null
  let bestCost = Infinity
  for (let start = 0; start < n; start++) {
    let ok = true
    let cost = 0 // wheelchair-accessible seats this run would use
    for (let k = 0; k < size && ok; k++) {
      ok = free[(start + k) % n]
      if (accessible[(start + k) % n]) cost++
    }
    if (ok && cost < bestCost) {
      best = Array.from({ length: size }, (_, k) => ids[(start + k) % n])
      bestCost = cost
    }
  }
  if (best) return best
  // No side-by-side run free: ordinary free seats first, then accessible ones.
  const order = ids.map((id, i) => ({ id, i })).filter(({ i }) => free[i]).sort((a, b) => Number(accessible[a.i]) - Number(accessible[b.i]))
  return order.slice(0, size).map((x) => x.id)
}
