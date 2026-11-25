import { useMemo } from 'react'
import type { DesignTable } from '../types'
import { DESIGN_CHAIR_RADIUS, designTableBox, overviewSize, shortName, toTable } from '../logic/designTables'
import { tableSize } from '../logic/geometry'
import { colors } from '../theme'

export interface TableName {
  text: string
  color: string
  /**
   * Tables with the same key that sit next to each other share ONE name, stretched across their combined width
   * (a big group spread over several tables). Leave out for one name per table.
   */
  groupKey?: string
}

interface TableNameLabelsProps {
  tables: DesignTable[]
  /** The name to show for a table (VIP guest, group, reserved party), or null for a plain table. */
  nameOf: (t: DesignTable) => TableName | null
  /** Screen pixels per layout unit. */
  scale: number
  /** Zoomed in far enough to see chairs: show full names and keep clear of the chairs. */
  zoomedIn: boolean
  /** Live floor only: how much bigger each table is drawn when zoomed out (see overviewGrowth). */
  growth?: Map<string, number>
}

/** Smallest name size in screen pixels (stays readable), and its size in floor units when zoomed in. */
const NAME_PX = 10
const NAME_UNITS = 1.2
const CHAR_W = 0.62

/** Real width of a name in bold, as a share of the font size, measured once per name with the page's own font. */
const widthCache = new Map<string, number>()
let measureCtx: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, size: number): number {
  let perUnit = widthCache.get(text)
  if (perUnit === undefined) {
    if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      measureCtx.font = `800 100px ${getComputedStyle(document.body).fontFamily}`
      perUnit = measureCtx.measureText(text).width / 100
    } else {
      perUnit = text.length * CHAR_W // no canvas (very old browser): fall back to an estimate
    }
    widthCache.set(text, perUnit)
  }
  // Plus the white edge drawn around the letters.
  return perUnit * size + size * 0.3
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * The area a table covers on the floor, for keeping names off it: table + chairs when chairs show; otherwise
 * the table top as drawn (on the zoomed-out live floor that's the bigger top, grown by `grow`).
 */
function tableRect(t: DesignTable, withChairs: boolean, grow?: number): Rect {
  if (withChairs) return designTableBox(t, DESIGN_CHAIR_RADIUS)
  let { width, height } = tableSize(toTable(t))
  if (grow !== undefined) {
    const s = overviewSize(t)
    width = s.width * grow
    height = s.height * grow
  }
  const a = (t.rotation * Math.PI) / 180
  const hw = t.shape === 'circle' ? width / 2 : (Math.abs(width * Math.cos(a)) + Math.abs(height * Math.sin(a))) / 2
  const hh = t.shape === 'circle' ? width / 2 : (Math.abs(width * Math.sin(a)) + Math.abs(height * Math.cos(a))) / 2
  return { minX: t.x - hw, minY: t.y - hh, maxX: t.x + hw, maxY: t.y + hh }
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))

/**
 * Big group tables with the same name count as one group for naming when they're in the same section,
 * or (without a section) closer than this, edge to edge, in floor units: about one row / aisle apart.
 */
const GROUP_GAP = 15

const union = (rs: Rect[]): Rect => ({
  minX: Math.min(...rs.map((r) => r.minX)),
  minY: Math.min(...rs.map((r) => r.minY)),
  maxX: Math.max(...rs.map((r) => r.maxX)),
  maxY: Math.max(...rs.map((r) => r.maxY)),
})
const gapBetween = (a: Rect, b: Rect) => Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minY - b.maxY, b.minY - a.maxY, 0)

/** One name to place: a single table, or a big group spread over neighbouring tables. */
interface NameItem {
  ids: string[]
  name: TableName
  box: Rect
}

/**
 * Names on VIP / group / reserved tables, full size where possible and never cut short.
 * A big group over several tables (same name, same section or near each other) gets ONE name, sized to span
 * their combined width.
 * Each name tries, in order: the middle of its table(s), just above, just below, then right or left beside,
 * always snug against its own table(s). A spot only counts if the name touches no other name and no other table.
 * Names on single tables (VIP, etc.) all stay the same size. A big group's spread-out name may shrink a little
 * (never below 7px) to fit. If every snug spot is taken, the name goes one line further above / below,
 * and if even that fails it takes the spot with the least overlap.
 * Names are done top to bottom, left to right.
 */
function TableNameLabels({ tables, nameOf, scale, zoomedIn, growth }: TableNameLabelsProps) {
  const font = Math.max(NAME_PX / scale, zoomedIn ? NAME_UNITS : 0)

  const placed = useMemo(() => {
    const result: { key: string; ids: string[]; text: string; color: string; x: number; y: number; size: number }[] = []
    const names: Rect[] = []
    // The table top as drawn right now (zoomed out on the live floor: the bigger one).
    const top = (t: DesignTable) => tableRect(t, false, zoomedIn ? undefined : growth?.get(t.id))
    const rects = new Map(tables.map((t) => [t.id, zoomedIn ? tableRect(t, true) : top(t)]))
    const minSize = 7 / scale

    // 1. Who gets a name, and which big-group tables share one (same name, sitting next to each other).
    const items: NameItem[] = []
    const byKey = new Map<string, DesignTable[]>()
    for (const t of tables) {
      const name = nameOf(t)
      if (!name || name.text.trim() === '') continue
      if (name.groupKey) byKey.set(name.groupKey, [...(byKey.get(name.groupKey) ?? []), t])
      else items.push({ ids: [t.id], name, box: top(t) })
    }
    for (const group of byKey.values()) {
      // Join tables into clusters of neighbours (a party split across the room gets one name per cluster).
      const clusters: DesignTable[][] = []
      for (const t of group) {
        const together = (o: DesignTable) =>
          (t.sectionId !== null && o.sectionId === t.sectionId) ||
          gapBetween(rects.get(o.id) as Rect, rects.get(t.id) as Rect) <= GROUP_GAP
        const touching = clusters.filter((c) => c.some(together))
        const merged = [t, ...touching.flat()]
        for (const c of touching) clusters.splice(clusters.indexOf(c), 1)
        clusters.push(merged)
      }
      for (const c of clusters) {
        items.push({ ids: c.map((t) => t.id), name: nameOf(c[0]) as TableName, box: union(c.map(top)) })
      }
    }
    items.sort((a, b) => (a.box.minY + a.box.maxY) / 2 - (b.box.minY + b.box.maxY) / 2 || a.box.minX - b.box.minX)

    // 2. Place each name.
    for (const item of items) {
      const { box } = item
      const cx = (box.minX + box.maxX) / 2
      const cy = (box.minY + box.maxY) / 2
      const spread = item.ids.length > 1
      // Everything this name must stay off: other names, and every table that isn't its own.
      const blockers = [...names, ...tables.filter((o) => !item.ids.includes(o.id)).map((o) => rects.get(o.id) as Rect)]

      // Text and sizes to try. A big group spanning several tables: the name stretches across their combined
      // width (full name if it fits well, otherwise the surname), but never taller than the tables themselves.
      let text = zoomedIn ? item.name.text.trim() : shortName(item.name.text)
      // One table (VIP, etc.): every name the same size, wherever it ends up — never shrunk.
      let sizes = [font]
      if (spread) {
        const boxW = box.maxX - box.minX
        const maxSize = Math.max(font, Math.min((box.maxY - box.minY) * 0.6, font * 2.5))
        const spanFor = (tx: string) => (boxW * 0.95) / (textWidth(tx, 1) || 1)
        const full = item.name.text.trim()
        text = spanFor(full) >= font * 0.8 ? full : shortName(full)
        const span = Math.min(spanFor(text), maxSize)
        sizes = [1, 0.85, 0.72, 0.6].map((f) => Math.max(span * f, minSize))
      }
      sizes = sizes.filter((v, i, all) => all.indexOf(v) === i)

      type Spot = { x: number; y: number; size: number; rect: Rect; cost: number }
      // Kept in an object so the helper below can update them (TypeScript tracks that correctly).
      const best: { chosen: Spot | null; fallback: Spot | null } = { chosen: null, fallback: null }
      const tryAt = (x: number, y: number, size: number, w: number, h: number) => {
        const rect = { minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 }
        const cost = blockers.reduce((sum, b) => sum + overlapArea(rect, b), 0)
        if (cost === 0) best.chosen = { x, y, size, rect, cost }
        else if (!best.fallback || cost < best.fallback.cost) best.fallback = { x, y, size, rect, cost }
        return cost === 0
      }
      // Snug spots right next to the table(s), at full size first, then a bit smaller.
      // (The box is the letters' height, so "just above" really sits just above the table.)
      for (const size of sizes) {
        const w = textWidth(text, size)
        const h = size * 1.05
        // Letters sit right on the table edge: the box's own padding is the only space between them.
        const above = box.minY - h / 2
        const below = box.maxY + h / 2
        // Slide sideways (still touching the table) before giving up on a spot.
        const half = (box.maxX - box.minX) / 2
        const slides = [0, -0.3, 0.3, -0.6, 0.6].map((f) => f * Math.min(w, w / 2 + half)).filter((dx) => Math.abs(dx) < w / 2 + half - size * 0.5)
        const spots = [
          { x: cx, y: cy }, // middle
          ...slides.map((dx) => ({ x: cx + dx, y: above })), // right on top of the table
          ...slides.map((dx) => ({ x: cx + dx, y: below })), // right under the table
          { x: box.maxX + w / 2, y: cy }, // right beside
          { x: box.minX - w / 2, y: cy }, // left beside
        ]
        if (spots.some((p) => tryAt(p.x, p.y, size, w, h))) break
      }
      // Last resort only: one line further above / below, at the smallest size.
      if (!best.chosen) {
        const size = sizes[sizes.length - 1]
        const w = textWidth(text, size)
        const h = size * 1.05
        const gap = size * 0.08
        const further = [
          { x: cx, y: box.minY - gap - h * 1.5 },
          { x: cx, y: box.maxY + gap + h * 1.5 },
        ]
        further.some((p) => tryAt(p.x, p.y, size, w, h))
      }
      const pick = best.chosen ?? best.fallback
      if (!pick) continue
      names.push(pick.rect)
      result.push({ key: item.ids.join('+'), ids: item.ids, text, color: item.name.color, x: pick.x, y: pick.y, size: pick.size })
    }
    return result
  }, [tables, nameOf, font, zoomedIn, scale, growth])

  return (
    <g pointerEvents="none">
      {placed.map((p) => (
        <text
          key={p.key}
          data-name-for={p.ids.join(' ')}
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={p.size}
          fontWeight={800}
          fill={p.color}
          stroke={colors.white}
          strokeWidth={p.size * 0.24}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ userSelect: 'none' }}
        >
          {p.text}
        </text>
      ))}
    </g>
  )
}

export default TableNameLabels
