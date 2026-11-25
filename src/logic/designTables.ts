// Rules for things the user places on their own canvas. Plain functions, no UI.

import type { ChairKind, DesignFeature, DesignTable, FeatureKind, RestaurantLayout, Table, TableKind, TableShape } from '../types'
import { TABLE_SCALE, tableBounds } from './geometry'

/** Allowed seat counts per shape. Long tables grow two seats at a time (one each side). */
export const SEAT_RULES: Record<TableShape, { min: number; max: number; step: number; start: number; label: string }> = {
  circle: { min: 2, max: 12, step: 1, start: 4, label: 'Round' },
  square: { min: 2, max: 4, step: 1, start: 4, label: 'Square' },
  rectangle: { min: 4, max: 20, step: 2, start: 6, label: 'Long' },
}

/** Most chairs one table can have. The database allows up to 60 per table (tables.seats). */
export const MAX_TABLE_SEATS = 60

/**
 * Most chairs on one VIP / big group table, per shape. The table grows to fit its chairs.
 * Round stops at 20 (about 17 ft across); long and square go up to the database limit.
 */
export const EXACT_MAX: Record<TableShape, number> = { circle: 20, square: MAX_TABLE_SEATS, rectangle: MAX_TABLE_SEATS }

/** Seat limits for a table of this shape and type. VIP / big group: any number from 1 up to the shape's max. */
export function seatRule(shape: TableShape, kind: TableKind) {
  const rule = SEAT_RULES[shape]
  return kind === 'regular' ? rule : { ...rule, min: 1, step: 1, max: EXACT_MAX[shape] }
}

// ---------- Exact chair counts (VIP and big group tables) ----------

/** Can a VIP / big group table of this shape hold this many chairs? (Used to grey out Round for big numbers.) */
export function shapeFits(shape: TableShape, seats: number): boolean {
  return seats <= EXACT_MAX[shape]
}

/**
 * Checks a typed exact chair count for one VIP / big group table.
 * Any whole number from 1 up to the shape's limit is fine, odd numbers too. Returns why not, or null if fine.
 */
export function exactSeatsProblem(shape: TableShape, seats: number): string | null {
  if (!Number.isInteger(seats) || seats < 1) return 'Type a whole number of chairs, 1 or more.'
  if (seats > MAX_TABLE_SEATS) {
    return `One table holds at most ${MAX_TABLE_SEATS} chairs. For more, make a big group of 2 or more tables.`
  }
  if (!shapeFits(shape, seats)) {
    return `A round table fits at most ${EXACT_MAX[shape]} chairs. Pick Long or Square for ${seats}.`
  }
  return null
}

/**
 * The table with exactly `seats` chairs. Its usual size is remembered (the first time it changes)
 * so it can be restored. Wheelchair marks are kept, so they come back too.
 */
export function withExactSeats(t: DesignTable, seats: number): DesignTable {
  const normal = t.normalSeats ?? t.seats
  return { ...t, seats, normalSeats: seats === normal ? null : normal }
}

/** The table back at its usual number of chairs (unchanged if it already has them). */
export function withNormalSeats(t: DesignTable): DesignTable {
  return t.normalSeats ? { ...t, seats: t.normalSeats, normalSeats: null } : t
}

/** Tables in label order: T2 before T10. */
export function byTableName(a: DesignTable, b: DesignTable): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true })
}

/**
 * Gives a big group exactly `total` chairs. Tables keep their usual size in label order and the
 * last tables give up chairs: 8 + 8 for 15 becomes 8 + 7. Every table keeps at least 1 chair.
 * More than the usual sizes hold: the last table grows (8 + 8 for 19 becomes 8 + 11), up to its shape's max.
 * Returns the changed tables, or why it can't be done.
 */
export function splitGroupSeats(tables: DesignTable[], total: number): { tables: DesignTable[] } | { problem: string } {
  const ordered = [...tables].sort(byTableName)
  const normals = ordered.map((t) => t.normalSeats ?? t.seats)
  const usual = normals.reduce((sum, n) => sum + n, 0)
  const n = ordered.length
  if (!Number.isInteger(total) || total < 1) return { problem: 'Type a whole number of seats, 1 or more.' }
  if (total < n) return { problem: `Each of the ${n} tables needs at least 1 chair, so this group needs at least ${n} seats.` }
  if (total > usual) {
    const last = ordered[n - 1]
    const lastMax = EXACT_MAX[last.shape]
    const most = usual - normals[n - 1] + lastMax
    if (total > most) {
      return { problem: `These ${n} tables hold at most ${most} (${last.name} can grow to ${lastMax}). Add a table to the group.` }
    }
    return { tables: ordered.map((t, i) => withExactSeats(t, i === n - 1 ? normals[i] + total - usual : normals[i])) }
  }
  let left = total
  const result = ordered.map((t, i) => {
    const tablesAfter = n - i - 1
    const seats = Math.min(normals[i], left - tablesAfter)
    left -= seats
    return withExactSeats(t, seats)
  })
  return { tables: result }
}

/**
 * The table changed to another type. Back to Regular: its usual chairs come back (an exact count is
 * only for VIP / big groups). Seats are kept within the new type's limits.
 */
export function withKind(t: DesignTable, kind: TableKind): DesignTable {
  const r = seatRule(t.shape, kind)
  if (kind === 'regular') {
    const base = withNormalSeats(t)
    let seats = clamp(base.seats, r.min, r.max)
    if (r.step === 2 && seats % 2 !== 0) seats = Math.min(r.max, seats + 1)
    return { ...base, kind, seats, normalSeats: null, chairKinds: base.chairKinds.slice(0, seats) }
  }
  const seats = clamp(t.seats, 1, r.max)
  return { ...withExactSeats(t, seats), kind }
}

/** Look and wording of each table type. */
export const TABLE_KINDS: Record<TableKind, { label: string; fill: string; stroke: string; text: string; namePrompt: string }> = {
  regular: { label: 'Regular', fill: '#D9DDE2', stroke: '#9AA3AD', text: '#1F2933', namePrompt: '' },
  vip: { label: 'VIP', fill: '#F6E7B4', stroke: '#C9A227', text: '#5C4A0E', namePrompt: 'VIP guest name' },
  group: { label: 'Big group', fill: '#E0D7F3', stroke: '#7E57C2', text: '#3B2670', namePrompt: 'Group name' },
}

/** What goes in the middle of a table: seat count for regular tables, the name for VIPs/groups. */
export function tableCenterText(t: DesignTable): string {
  if (t.kind === 'vip') return t.guestName.trim() || 'VIP'
  if (t.kind === 'group') return t.guestName.trim() || String(t.seats)
  return String(t.seats)
}

/** Starting size and look of each non-table item. Sizes are in layout units (roughly feet). */
export const FEATURE_PRESETS: Record<FeatureKind, { label: string; width: number; height: number; fill: string; text: string }> = {
  stage: { label: 'Stage', width: 20, height: 10, fill: '#EADFCB', text: '#7A6A4F' },
  divider: { label: 'Divider', width: 12, height: 0.8, fill: '#8D7B68', text: '#5B4B3A' },
  bar: { label: 'Bar', width: 14, height: 4, fill: '#C9B79C', text: '#5B4B3A' },
  buffet: { label: 'Buffet', width: 12, height: 3, fill: '#E3D5BC', text: '#7A6A4F' },
  entrance: { label: 'Entrance', width: 8, height: 2, fill: '#CFE3D6', text: '#2A6B45' },
}

/** Section colors: soft enough to sit behind tables, distinct from each other. */
/**
 * Section colors, picked by computer so that every color looks clearly different from every other one
 * (each next color is the one least like all the colors before it), and all are dark enough
 * for section names to stay readable on the light floor.
 */
export const SECTION_COLORS = [
  '#E4572E', '#0606EF', '#049F04', '#1F99D6', '#F924B2', '#565229', '#532E9E', '#7E254A', '#049F78', '#9F9204',
  '#D624F9', '#F9246B', '#1D5763', '#B668B6', '#B67568', '#067AEF', '#424E8A', '#407010', '#7C3603', '#245AF9',
] as const

/** Below this, two colors are too alike to tell sections apart (perceptual difference, CIE76 ΔE). */
export const TOO_SIMILAR = 20

/** How different two colors look to the eye (0 = identical; ~2 = barely noticeable; 30+ = clearly different). */
export function colorDistance(a: string, b: string): number {
  const p = toLab(a)
  const q = toLab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

function toLab(hex: string): [number, number, number] {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const [r, g, b] = c
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** True if `color` looks too much like one of `others`. */
export function looksLikeAny(color: string, others: Iterable<string>): boolean {
  for (const o of others) if (colorDistance(color, o) < TOO_SIMILAR) return true
  return false
}

/**
 * A color for a section that looks as different as possible from every color already used:
 * the palette color least like the used ones; with very many sections, a freshly made color.
 */
export function unusedSectionColor(used: Iterable<string>): string {
  const taken = [...used]
  const farthest = (options: readonly string[]) => {
    let best = options[0]
    let bestD = -1
    for (const c of options) {
      const d = taken.length === 0 ? Infinity : Math.min(...taken.map((u) => colorDistance(c, u)))
      if (d > bestD) {
        best = c
        bestD = d
      }
    }
    return { best, bestD }
  }
  const fromPalette = farthest(SECTION_COLORS)
  if (fromPalette.bestD >= TOO_SIMILAR) return fromPalette.best
  // Palette used up: try many made-up colors and keep the one least like anything used.
  const made: string[] = []
  for (let h = 0; h < 360; h += 6) for (const l of [30, 40, 50]) made.push(hslToHex(h, 80, l))
  const fromMade = farthest(made)
  return fromMade.bestD > fromPalette.bestD ? fromMade.best : fromPalette.best
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

/** Radius of a chair dot on the design canvas. */
export const DESIGN_CHAIR_RADIUS = 0.8 * TABLE_SCALE

/** Turn steps offered in the editor, in degrees. */
export const ROTATE_STEP = 15

/** Seat kinds in the order a tap cycles through them. */
export const CHAIR_KIND_CYCLE: ChairKind[] = ['standard', 'wheelchair']

/** Most extra highchairs one table can have. */
export const MAX_HIGHCHAIRS = 4

export function chairKindAt(t: DesignTable, index: number): ChairKind {
  return t.chairKinds[index] ?? 'standard'
}

/** Converts a design table into the shape the geometry helpers expect, so chairs can be drawn. */
export function toTable(t: DesignTable): Table {
  return {
    id: t.id,
    name: t.name,
    sectionId: t.sectionId ?? '',
    shape: t.shape,
    x: t.x,
    y: t.y,
    // A table cut down to fewer chairs keeps its usual size on the floor (with a gap).
    size: t.normalSeats ?? undefined,
    chairs: [
      // The table's own seats (some may be wheelchair spots)...
      ...Array.from({ length: t.seats }, (_, i) => ({
        id: `${t.id}-${i + 1}`,
        tableId: t.id,
        number: i + 1,
        kind: chairKindAt(t, i) === 'wheelchair' ? ('wheelchair' as const) : ('standard' as const),
      })),
      // ...plus extra highchairs, which don't use up a seat. Ids look like "T3-h1".
      ...Array.from({ length: t.highchairs ?? 0 }, (_, k) => ({
        id: `${t.id}-h${k + 1}`,
        tableId: t.id,
        number: t.seats + k + 1,
        kind: 'highchair' as const,
      })),
    ],
  }
}

export function totalSeats(tables: DesignTable[]): number {
  return tables.reduce((sum, t) => sum + t.seats, 0)
}

export function countKind(tables: DesignTable[], kind: ChairKind): number {
  if (kind === 'highchair') return tables.reduce((sum, t) => sum + (t.highchairs ?? 0), 0)
  return tables.reduce((sum, t) => sum + t.chairKinds.slice(0, t.seats).filter((k) => k === kind).length, 0)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Keeps an angle in 0..359. */
export function normalizeAngle(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360
}

/** A unique id, e.g. for a new table ("D...") or feature ("F..."). */
export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Rotates a box's corners around the origin and returns the box that fits around them. */
function rotatedBox(minX: number, minY: number, maxX: number, maxY: number, deg: number): Box {
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
    xs.push(x * cos - y * sin)
    ys.push(x * sin + y * cos)
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** The area a table and its chairs cover on the canvas, after turning. */
export function designTableBox(t: DesignTable, chairRadius: number): Box {
  const b = tableBounds(toTable(t), chairRadius)
  const r = rotatedBox(b.minX, b.minY, b.minX + b.width, b.minY + b.height, t.rotation)
  return { minX: r.minX + t.x, minY: r.minY + t.y, maxX: r.maxX + t.x, maxY: r.maxY + t.y }
}

/** Box around a group of tables (used to draw a section's outline). Null if the group is empty. */
export function groupBox(tables: DesignTable[], chairRadius: number, padding: number): Box | null {
  if (tables.length === 0) return null
  const boxes = tables.map((t) => designTableBox(t, chairRadius))
  return {
    minX: Math.min(...boxes.map((b) => b.minX)) - padding,
    minY: Math.min(...boxes.map((b) => b.minY)) - padding,
    maxX: Math.max(...boxes.map((b) => b.maxX)) + padding,
    maxY: Math.max(...boxes.map((b) => b.maxY)) + padding,
  }
}

/** A fresh feature of the given kind, centered at (x, y). */
export function makeFeature(kind: FeatureKind, x: number, y: number): DesignFeature {
  const p = FEATURE_PRESETS[kind]
  // Dividers have no label: it would only take up space.
  return { id: newId('F'), kind, label: kind === 'divider' ? '' : p.label, x, y, width: p.width, height: p.height, rotation: 0 }
}

/** Next n free table labels, continuing after the highest number used: T7, T8, T9... */
export function nextTableNames(tables: DesignTable[], n: number): string[] {
  const used = tables.map((t) => Number(t.name.replace(/^T/, ''))).filter((v) => Number.isFinite(v))
  const start = Math.max(0, ...used) + 1
  return Array.from({ length: n }, (_, i) => `T${start + i}`)
}

const overlaps = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/**
 * Finds `count` empty spots for copies of `template`, scanning in rows to the right of and below
 * (startX, startY) and skipping anything already on the floor. Spots that don't fit are left out.
 */
export function findFreeSpots(
  template: DesignTable,
  count: number,
  startX: number,
  startY: number,
  existing: DesignTable[],
  floor: { width: number; height: number },
): { x: number; y: number }[] {
  const gap = 1.5
  const own = designTableBox({ ...template, x: 0, y: 0 }, DESIGN_CHAIR_RADIUS)
  const stepX = own.maxX - own.minX + gap
  const stepY = own.maxY - own.minY + gap
  const taken = existing.map((t) => designTableBox(t, DESIGN_CHAIR_RADIUS))
  const spots: { x: number; y: number }[] = []
  const fits = (x: number, y: number) => {
    const box = { minX: own.minX + x, minY: own.minY + y, maxX: own.maxX + x, maxY: own.maxY + y }
    if (box.minX < 0 || box.minY < 0 || box.maxX > floor.width || box.maxY > floor.height) return false
    return !taken.some((b) => overlaps(b, box))
  }
  // Rows from the start point downward, then rows above the start point (going up).
  const rowCount = Math.floor(floor.height / stepY) + 1
  const rows: number[] = []
  for (let r = 0; r < rowCount; r++) rows.push(startY + r * stepY)
  for (let r = 1; r < rowCount; r++) rows.push(startY - r * stepY)
  for (let r = 0; r < rows.length && spots.length < count; r++) {
    const y = rows[r]
    // The first row continues to the right of the start; later rows begin at the left of the start.
    const firstX = r === 0 ? startX : startX - Math.floor(startX / stepX) * stepX
    for (let x = firstX; x <= floor.width && spots.length < count; x += stepX) {
      if (!fits(x, y)) continue
      spots.push({ x, y })
      taken.push({ minX: own.minX + x, minY: own.minY + y, maxX: own.maxX + x, maxY: own.maxY + y })
    }
  }
  return spots
}

// ---------- Working on many selected things at once ----------

type Positioned = { id: string; x: number; y: number }

/** Puts everything on one horizontal line (their average height). */
export function alignInRow(items: Positioned[]): Positioned[] {
  const y = Math.round((items.reduce((s, i) => s + i.y, 0) / items.length) * 2) / 2
  return items.map((i) => ({ ...i, y }))
}

/** Puts everything on one vertical line (their average left-right position). */
export function alignInColumn(items: Positioned[]): Positioned[] {
  const x = Math.round((items.reduce((s, i) => s + i.x, 0) / items.length) * 2) / 2
  return items.map((i) => ({ ...i, x }))
}

/**
 * Spreads things out evenly between the two outermost ones, along whichever direction
 * they are already spread out more (left-right or up-down).
 */
export function spaceEvenly(items: Positioned[]): Positioned[] {
  if (items.length < 3) return items
  const xs = items.map((i) => i.x)
  const ys = items.map((i) => i.y)
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
  const axis = horizontal ? 'x' : 'y'
  const sorted = [...items].sort((a, b) => a[axis] - b[axis])
  const first = sorted[0][axis]
  const step = (sorted[sorted.length - 1][axis] - first) / (sorted.length - 1)
  return sorted.map((item, i) => ({ ...item, [axis]: Math.round((first + step * i) * 2) / 2 }))
}

/** The area a room item covers, after turning. */
export function featureBox(f: DesignFeature): Box {
  const r = rotatedBox(-f.width / 2, -f.height / 2, f.width / 2, f.height / 2, f.rotation)
  return { minX: r.minX + f.x, minY: r.minY + f.y, maxX: r.maxX + f.x, maxY: r.maxY + f.y }
}

const insideFloor = (b: Box, floor: { width: number; height: number }) =>
  b.minX >= 0 && b.minY >= 0 && b.maxX <= floor.width && b.maxY <= floor.height

/**
 * Finds where a copy of a group (tables and/or room items) can go: right beside it, else below, left or above.
 * `groupBoxes` are the areas the group covers now; `otherBoxes` everything else on the floor.
 * Returns the shift to apply, or null if none of those spots is free.
 */
export function findGroupCopyOffset(
  groupBoxes: Box[],
  otherBoxes: Box[],
  floor: { width: number; height: number },
): { dx: number; dy: number } | null {
  if (groupBoxes.length === 0) return null
  const gap = 2
  const w = Math.max(...groupBoxes.map((b) => b.maxX)) - Math.min(...groupBoxes.map((b) => b.minX)) + gap
  const h = Math.max(...groupBoxes.map((b) => b.maxY)) - Math.min(...groupBoxes.map((b) => b.minY)) + gap
  const taken = [...groupBoxes, ...otherBoxes]
  for (const [dx, dy] of [[w, 0], [0, h], [-w, 0], [0, -h], [w, h], [-w, h], [w, -h], [-w, -h]]) {
    const ok = groupBoxes.every((g) => {
      const b = { minX: g.minX + dx, minY: g.minY + dy, maxX: g.maxX + dx, maxY: g.maxY + dy }
      return insideFloor(b, floor) && !taken.some((o) => overlaps(o, b))
    })
    if (ok) return { dx, dy }
  }
  return null
}

/**
 * Spots for `count` copies of a room item, side by side next to it (dividers become parallel lines):
 * stepping across its depth, first one way, then the other, skipping anything in the way.
 */
export function featureCopySpots(
  f: DesignFeature,
  count: number,
  otherBoxes: Box[],
  floor: { width: number; height: number },
): { x: number; y: number }[] {
  const a = (f.rotation * Math.PI) / 180
  const step = f.height + 3 // the item's depth plus a walkway-sized gap
  const dir = { x: -Math.sin(a) * step, y: Math.cos(a) * step }
  const taken = [featureBox(f), ...otherBoxes]
  const spots: { x: number; y: number }[] = []
  for (const sign of [1, -1]) {
    for (let k = 1; k <= 200 && spots.length < count; k++) {
      const x = f.x + dir.x * k * sign
      const y = f.y + dir.y * k * sign
      const b = featureBox({ ...f, x, y })
      if (!insideFloor(b, floor)) break
      if (taken.some((o) => overlaps(o, b))) continue
      spots.push({ x, y })
      taken.push(b)
    }
  }
  return spots
}

// ---------- Section names ----------

/** Rough size of a section name written at `fontSize` (uppercase bold), so it can be kept clear of everything. */
export function labelSize(name: string, fontSize: number): { width: number; height: number } {
  return { width: Math.max(1, name.length) * fontSize * 0.68 + fontSize * 0.4, height: fontSize * 1.3 }
}

// ---------- Exact shapes for keeping names clear ----------

type Pt = { x: number; y: number }

/** The 4 corners of a box that is turned `deg` degrees around (cx, cy). */
function corners(cx: number, cy: number, minX: number, minY: number, maxX: number, maxY: number, deg: number): Pt[] {
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }))
}

/** A table's real (possibly turned) outline, chairs included. */
export function tableShape(t: DesignTable): Pt[] {
  const b = tableBounds(toTable({ ...t, x: 0, y: 0 }), DESIGN_CHAIR_RADIUS)
  return corners(t.x, t.y, b.minX, b.minY, b.minX + b.width, b.minY + b.height, t.rotation)
}

/** A room item's real (possibly turned) outline — a diagonal divider stays a thin line, not a big box. */
export function featureShape(f: DesignFeature): Pt[] {
  return corners(f.x, f.y, -f.width / 2, -f.height / 2, f.width / 2, f.height / 2, f.rotation)
}

/** Do two 4-cornered shapes overlap? (Separating-axis test: they don't if some edge direction splits them.) */
export function shapesOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const nx = q.y - p.y
      const ny = p.x - q.x
      const project = (pts: Pt[]) => pts.map((v) => v.x * nx + v.y * ny)
      const pa = project(a)
      const pb = project(b)
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false
    }
  }
  return true
}

const rectShape = (cx: number, cy: number, w: number, h: number): Pt[] => corners(cx, cy, -w / 2, -h / 2, w / 2, h / 2, 0)

// ---------- Zoomed-out live floor: bigger tables ----------

/** How far the fullness glow reaches past a table on the zoomed-out live floor, in layout units. */
export const OVERVIEW_HALO = 1.6
/** Tables grow at most this much past the space their chairs use. */
export const OVERVIEW_MAX_GROW = 1.5
/** Extra space kept between two grown glows (and between a glow and a room item), in layout units. */
const OVERVIEW_GAP = 0.8

/**
 * Zoomed out, the chairs are hidden, so the table top is drawn over the space they would use:
 * the size of table + chairs (not turned), kept centered on the table.
 */
export function overviewSize(t: DesignTable): { width: number; height: number } {
  const b = tableBounds(toTable({ ...t, x: 0, y: 0 }), DESIGN_CHAIR_RADIUS)
  // Centered: an empty chair spot on one side mustn't shift the table off its real middle.
  const width = 2 * Math.max(-b.minX, b.minX + b.width)
  const height = 2 * Math.max(-b.minY, b.minY + b.height)
  return t.shape === 'circle' ? { width: Math.max(width, height), height: Math.max(width, height) } : { width, height }
}

/** A table's glow outline (turned with the table) when grown by `k`, plus `pad` on every side. */
function glowOutline(t: DesignTable, k: number, pad: number): Pt[] {
  const s = overviewSize(t)
  const hw = (s.width * k) / 2 + OVERVIEW_HALO + pad
  const hh = (s.height * k) / 2 + OVERVIEW_HALO + pad
  return corners(t.x, t.y, -hw, -hh, hw, hh, t.rotation)
}

/** The biggest grow factor from 1 to the max for which `fits` is true (it only gets harder as tables grow). */
function largestFit(fits: (k: number) => boolean): number {
  if (fits(OVERVIEW_MAX_GROW)) return OVERVIEW_MAX_GROW
  if (!fits(1)) return 1
  let lo = 1
  let hi = OVERVIEW_MAX_GROW
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * How much each table can grow on the zoomed-out live floor (table id → factor, 1 to 1.5) without its glow
 * touching another table's glow or any room item (dividers, stage, bar...). Positions never change.
 * All tables in a section grow by the same amount (the section's tightest spot), so same-size tables still match.
 * A table already touching something stays at 1: never worse than before.
 */
export function overviewGrowth(layout: { tables: DesignTable[]; features: DesignFeature[] }): Map<string, number> {
  const { tables } = layout
  const pad = OVERVIEW_GAP / 2
  const features = layout.features.map(featureShape)
  const limit = tables.map(() => OVERVIEW_MAX_GROW)
  // Already touching something at normal size (no room at all): stays as it is, without holding its section back.
  const stuck = tables.map(() => false)
  // How far each table's grown glow can reach from its middle: pairs further apart than that can't touch.
  const reach = tables.map((t) => {
    const s = overviewSize(t)
    return (Math.hypot(s.width, s.height) / 2) * OVERVIEW_MAX_GROW + OVERVIEW_HALO + pad
  })
  const cap = (i: number, k: number, fitsAtNormal: boolean) => {
    limit[i] = Math.min(limit[i], k)
    if (!fitsAtNormal) stuck[i] = true
  }

  tables.forEach((t, i) => {
    // Room items don't grow: this table alone must stay clear of the ones its biggest glow would touch.
    const near = features.filter((f) => shapesOverlap(glowOutline(t, OVERVIEW_MAX_GROW, pad), f))
    const clearOfItems = (k: number) => !near.some((f) => shapesOverlap(glowOutline(t, k, pad), f))
    if (near.length > 0) cap(i, largestFit(clearOfItems), clearOfItems(1))
    // Two tables: both grow by the same amount; find the most they can both take. (Each ends up growing
    // by no more than this, so they stay apart: a smaller outline sits inside the bigger one.)
    for (let j = i + 1; j < tables.length; j++) {
      const u = tables[j]
      if (Math.hypot(u.x - t.x, u.y - t.y) > reach[i] + reach[j]) continue
      const apart = (g: number) => !shapesOverlap(glowOutline(t, g, pad), glowOutline(u, g, pad))
      const k = largestFit(apart)
      const ok = apart(1)
      cap(i, k, ok)
      cap(j, k, ok)
    }
  })

  // Same growth across a section: its tightest table that still has some room sets it.
  const bySection = new Map<string, number>()
  tables.forEach((t, i) => {
    if (t.sectionId && !stuck[i]) bySection.set(t.sectionId, Math.min(bySection.get(t.sectionId) ?? OVERVIEW_MAX_GROW, limit[i]))
  })
  return new Map(
    tables.map((t, i) => [t.id, stuck[i] ? 1 : t.sectionId ? Math.min(bySection.get(t.sectionId) ?? limit[i], limit[i]) : limit[i]]),
  )
}

/**
 * Where to put a section's name: always directly under one of its own tables.
 * 1. The bottom-middle of the section, if that's right under its tables and free.
 * 2. Otherwise under its lowest table that has room (then the next lowest, ...).
 * "Free" means the name touches no table or room item. Last resort: under the lowest table anyway.
 */
export function sectionLabelSpot(
  layout: RestaurantLayout,
  sectionId: string,
  label: { width: number; height: number },
  gap: number,
): Pt | null {
  const own = layout.tables.filter((t) => t.sectionId === sectionId)
  if (own.length === 0) return null
  const ownShapes = own.map(tableShape)
  const obstacles = [...layout.tables.map(tableShape), ...layout.features.map(featureShape)]
  const free = (p: Pt) => !obstacles.some((o) => shapesOverlap(rectShape(p.x, p.y, label.width, label.height), o))
  const bottomOf = (shape: Pt[]) => Math.max(...shape.map((v) => v.y))

  // 1. Bottom-middle of the whole section — only if it's snug under the section's own tables.
  const area = groupBox(own, DESIGN_CHAIR_RADIUS, 0)
  if (area) {
    const p = { x: (area.minX + area.maxX) / 2, y: area.maxY + gap + label.height / 2 }
    const near = ownShapes.some((s) => shapesOverlap(rectShape(p.x, p.y, label.width + 3, label.height + gap * 2 + 3), s))
    if (near && free(p)) return p
  }

  // 2. Under each of its tables, lowest first.
  const under = own
    .map((t, i) => ({ x: t.x, y: bottomOf(ownShapes[i]) + gap + label.height / 2 }))
    .sort((a, b) => b.y - a.y)
  return under.find(free) ?? under[0]
}

/** Words that describe the party rather than name it ("Smith family" → "Smith"). */
const PARTY_WORDS = new Set([
  'family', 'families', 'ohana', 'party', 'group', 'table', 'reunion', 'wedding', 'birthday', 'anniversary',
  'graduation', 'celebration', 'luau', 'guests', 'friends', 'team', 'club', 'company', 'and', '&', '+',
])

/**
 * The short name to show on a small table: the surname, i.e. the last real word of the name.
 * "Mayor Kealoha" → "Kealoha", "John & Mary Smith" → "Smith", "Smith family" → "Smith".
 */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].replace(/[.,;:!?'"’)]+$/g, '')
    if (w && !PARTY_WORDS.has(w.toLowerCase())) return w
  }
  return name.trim()
}

/**
 * The part of the floor that's actually used (tables with their chairs, plus room items), with a little margin,
 * so the "whole layout" view can zoom to the restaurant instead of showing empty floor around it.
 * An empty floor returns the whole floor.
 */
export function contentBox(layout: { width: number; height: number; tables: DesignTable[]; features: DesignFeature[] }): Box {
  const boxes = [...layout.tables.map((t) => designTableBox(t, DESIGN_CHAIR_RADIUS)), ...layout.features.map(featureBox)]
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height }
  const margin = 3
  return {
    minX: Math.max(0, Math.min(...boxes.map((b) => b.minX)) - margin),
    minY: Math.max(0, Math.min(...boxes.map((b) => b.minY)) - margin),
    maxX: Math.min(layout.width, Math.max(...boxes.map((b) => b.maxX)) + margin),
    maxY: Math.min(layout.height, Math.max(...boxes.map((b) => b.maxY)) + margin),
  }
}
