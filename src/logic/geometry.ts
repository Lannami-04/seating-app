// Pure functions that decide where tables and chairs are drawn.
// Coordinates are in layout units (roughly feet), relative to the table center.

import type { Table } from '../types'

export interface Point {
  x: number
  y: number
}

/**
 * How big tables and chairs are drawn, everywhere (1 = the original size).
 * Bigger is easier to see and to tap on a tablet; tables placed close together may then touch.
 */
export const TABLE_SCALE = 1.2

/** Distance from the table edge to the center of each chair. */
export const CHAIR_OFFSET = 1.3 * TABLE_SCALE
/** Space between neighbouring chairs along a rectangle's long side. */
const CHAIR_SPACING = 2.4 * TABLE_SCALE
const RECT_WIDTH = 3 * TABLE_SCALE

const ROUND_RADIUS: Record<number, number> = { 8: 3, 10: 3.5, 12: 4 }

export function roundRadius(seats: number): number {
  return (ROUND_RADIUS[seats] ?? Math.max(2, seats * 0.35)) * TABLE_SCALE
}

/** Width and height of the table top itself (not including chairs). */
/** The table's own seats (extra highchairs don't make the table bigger). */
export function seatCount(table: Table): number {
  return table.chairs.filter((c) => c.kind !== 'highchair').length
}

/**
 * How many seats the table top is drawn for: its usual size if it has fewer chairs than that, never fewer
 * than its chairs. Long tables have one chair at each end and pairs along the sides, so they are drawn for an
 * even number (at least 4); with an odd number of chairs, one spot stays empty.
 */
function drawnFor(table: Table): number {
  const n = Math.max(table.size ?? 0, seatCount(table))
  return table.shape === 'rectangle' ? Math.max(4, n + (n % 2)) : n
}

export function tableSize(table: Table): { width: number; height: number } {
  const seats = drawnFor(table)
  if (table.shape === 'circle') {
    const d = roundRadius(seats) * 2
    return { width: d, height: d }
  }
  if (table.shape === 'square') {
    const side = (seats <= 2 ? 2.5 : 3) * TABLE_SCALE
    return { width: side, height: side }
  }
  const perSide = Math.max(1, (seats - 2) / 2)
  return { width: perSide * CHAIR_SPACING, height: RECT_WIDTH }
}

/**
 * One position per chair, in the same order as table.chairs. Clockwise from the top.
 * Extra highchairs are squeezed in between two seats, a little further out.
 */
export function chairPositions(table: Table): Point[] {
  const seatPoints = seatPositions(table)
  const highchairs = table.chairs.length - seatPoints.length
  const n = seatPoints.length
  const extra: Point[] = []
  for (let k = 0; k < highchairs; k++) {
    // Spread highchairs around: between seat i and the next one.
    const i = Math.floor((k * n) / highchairs + n / (2 * Math.max(1, highchairs))) % n
    const a = seatPoints[i]
    const b = seatPoints[(i + 1) % n]
    let mx = (a.x + b.x) / 2
    let my = (a.y + b.y) / 2
    const len = Math.hypot(mx, my)
    // Far enough out that it clears both neighbours, even with the big chairs in the table close-up.
    const reach = Math.max(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y)) + 1.7 * TABLE_SCALE
    if (len < 0.01) {
      // Two chairs facing each other: put the highchair at the top instead.
      mx = 0
      my = -reach
    } else {
      mx = (mx / len) * reach
      my = (my / len) * reach
    }
    extra.push({ x: mx, y: my })
  }
  return [...seatPoints, ...extra]
}

/**
 * Positions of the table's own seats (not the extra highchairs).
 * Spots are worked out for the size the table is drawn for; a table with fewer chairs than that
 * uses the first spots and leaves the last ones empty.
 */
function seatPositions(table: Table): Point[] {
  const seats = seatCount(table)
  const spots = drawnFor(table)
  const { width, height } = tableSize(table)

  if (table.shape === 'circle') {
    const r = width / 2 + CHAIR_OFFSET
    return Array.from({ length: seats }, (_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / spots
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
    })
  }

  if (table.shape === 'square' && spots <= 4) {
    const dx = width / 2 + CHAIR_OFFSET
    const dy = height / 2 + CHAIR_OFFSET
    // 2-tops face each other left/right; 4-tops get one chair per side.
    const points: Point[] =
      spots <= 2
        ? [{ x: -dx, y: 0 }, { x: dx, y: 0 }]
        : [{ x: 0, y: -dy }, { x: dx, y: 0 }, { x: 0, y: dy }, { x: -dx, y: 0 }]
    return points.slice(0, seats)
  }

  // Rectangle: one chair at each end, the rest split along the two long sides.
  const perSide = Math.max(1, (spots - 2) / 2)
  const top = -(height / 2 + CHAIR_OFFSET)
  const bottom = height / 2 + CHAIR_OFFSET
  const sideX = (i: number) => -width / 2 + CHAIR_SPACING * (i + 0.5)
  const points: Point[] = []
  for (let i = 0; i < perSide; i++) points.push({ x: sideX(i), y: top })
  points.push({ x: width / 2 + CHAIR_OFFSET, y: 0 })
  for (let i = perSide - 1; i >= 0; i--) points.push({ x: sideX(i), y: bottom })
  points.push({ x: -(width / 2 + CHAIR_OFFSET), y: 0 })
  return points.slice(0, seats)
}

/** Box around the table and all its chairs, given a chair radius. */
export function tableBounds(table: Table, chairRadius: number): { minX: number; minY: number; width: number; height: number } {
  const { width, height } = tableSize(table)
  let minX = -width / 2
  let maxX = width / 2
  let minY = -height / 2
  let maxY = height / 2
  for (const p of chairPositions(table)) {
    minX = Math.min(minX, p.x - chairRadius)
    maxX = Math.max(maxX, p.x + chairRadius)
    minY = Math.min(minY, p.y - chairRadius)
    maxY = Math.max(maxY, p.y + chairRadius)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}
