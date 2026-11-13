// Colors for families. None of them is gray (= free) or green (= full table),
// so a family color is never confused with a table status.

import type { Family } from '../types'

export const FAMILY_COLORS = [
  '#E4572E', // coral
  '#2E86DE', // blue
  '#8E44AD', // purple
  '#F4A300', // amber
  '#D63384', // pink
  '#795548', // brown
  '#3F51B5', // indigo
  '#0097A7', // cyan
] as const

/**
 * Picks the color used least by the families already at the table,
 * so families sitting together always look different (until 8+ families share a table).
 */
export function pickFamilyColor(familiesAtTable: Family[]): string {
  const uses = new Map<string, number>(FAMILY_COLORS.map((c) => [c, 0]))
  for (const f of familiesAtTable) {
    if (uses.has(f.color)) uses.set(f.color, (uses.get(f.color) ?? 0) + 1)
  }
  let best: string = FAMILY_COLORS[0]
  for (const color of FAMILY_COLORS) {
    if ((uses.get(color) ?? 0) < (uses.get(best) ?? 0)) best = color
  }
  return best
}
