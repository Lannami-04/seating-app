import type { DesignTable } from '../types'
import { chairPositions, tableSize } from '../logic/geometry'
import { DESIGN_CHAIR_RADIUS, TABLE_KINDS, designTableBox, shortName, tableCenterText, toTable } from '../logic/designTables'
import { colors } from '../theme'
import ChairKindIcon from './ChairKindIcon'

/** How a table looks during live seating (instead of its design colors). */
export interface LiveTableLook {
  fill: string
  stroke: string
  textColor: string
  /** Dashed outline: held for a party that hasn't arrived. */
  dashed: boolean
  /** Shown in the middle: open seats, or the party's name. Empty = nothing. */
  centerText: string
  /** Color of each chair, by position. */
  chairFill: (index: number) => string
  /** When someone last checked this table against the real floor (ms), if ever: a small ✓ is shown. */
  checkedAt?: number
}

interface DesignTableShapeProps {
  table: DesignTable
  /** Orange outline: the table being edited. */
  selected?: boolean
  /** Thick blue outline: picked while building a section. */
  picked?: boolean
  /** Draw each chair (only when zoomed in, or for the selected table). */
  showChairs?: boolean
  /** Draw the center text and table name (off for tiny previews). */
  showText?: boolean
  /** Screen pixels per layout unit right now, so touch areas and text never get too small. */
  scale?: number
  /** Live seating: status colors and text instead of the design look. */
  live?: LiveTableLook
  /** Names are drawn by TableNameLabels (placed so they don't overlap); only numbers go in the table. */
  hideNames?: boolean
}

const PICK_COLOR = '#1F6F8B'
/** Smallest touch target, in screen pixels. */
const MIN_TOUCH_PX = 48
/** Smallest readable text, in screen pixels. */
const MIN_TEXT_PX = 11
/** Names may shrink a little further than numbers before being cut short, so whole surnames fit more often. */
const MIN_NAME_PX = 7
/** Average width of one uppercase-ish bold letter, as a share of the font size. */
const CHAR_W = 0.6

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Splits a name into at most two balanced lines so it can be drawn larger. */
function nameLines(name: string): string[] {
  const words = name.trim().split(/\s+/)
  if (words.length === 1 || name.length <= 8) return [name]
  let best = [name]
  let bestLen = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    if (Math.max(a.length, b.length) < bestLen) {
      best = [a, b]
      bestLen = Math.max(a.length, b.length)
    }
  }
  return best
}

/**
 * One designed table. Zoomed out it's just the table top with its seat count (or VIP name) in the middle;
 * zoomed in or selected, the individual chairs appear.
 */
function DesignTableShape({ table, selected = false, picked = false, showChairs = false, showText = true, scale = 10, live, hideNames = false }: DesignTableShapeProps) {
  const asTable = toTable(table)
  const { width, height } = tableSize(asTable)
  const kindLook = TABLE_KINDS[table.kind]
  const look = live ? { fill: live.fill, stroke: live.stroke, text: live.textColor } : kindLook
  const outline = picked ? PICK_COLOR : selected ? colors.selection : look.stroke

  // Text in the middle: big number for regular tables, a name for VIP / groups.
  const centerText = live ? live.centerText : tableCenterText(table)
  const isNumber = /^\d+$/.test(centerText)

  // Names on long tables run along the table (turned with it, but never upside down): about twice the room.
  const deg = ((table.rotation % 360) + 360) % 360
  const alongTable = !isNumber && centerText !== '' && table.shape === 'rectangle'
  const textAngle = alongTable ? (deg > 90 && deg <= 270 ? deg - 180 : deg) : 0

  // Room for the text inside the table top.
  const a = (table.rotation * Math.PI) / 180
  const mostlyLevel = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a))
  const diagonal = Math.abs(Math.abs(Math.cos(a)) - Math.abs(Math.sin(a))) < 0.5
  const inset = table.shape === 'circle' ? 0.8 : 0.88
  let across: number
  let down: number
  if (alongTable) {
    across = width // along the table's length
    down = height
  } else if (table.shape === 'circle' || diagonal) {
    across = down = Math.min(width, height)
  } else {
    across = mostlyLevel ? width : height // upright text on a turned table
    down = mostlyLevel ? height : width
  }
  const roomW = across * inset
  const roomH = down * inset

  let lines: string[]
  let fontSize: number
  if (centerText === '' || (hideNames && !isNumber)) {
    lines = []
    fontSize = 1
  } else if (isNumber) {
    lines = [centerText]
    fontSize = Math.max(Math.min(roomW, roomH) * 0.7, MIN_TEXT_PX / scale)
  } else {
    // Biggest size at which these lines fit inside the table.
    const fitFor = (ls: string[]) =>
      Math.min(roomW / (Math.max(1, ...ls.map((l) => l.length)) * CHAR_W), (roomH * 0.85) / (ls.length * 1.05))
    const minFont = MIN_NAME_PX / scale
    // Full name if it fits whole (zoomed in), otherwise just the surname.
    const full = nameLines(centerText)
    const surname = [shortName(centerText)]
    lines = showChairs && fitFor(full) >= minFont ? full : surname
    fontSize = Math.max(fitFor(lines), minFont)
    // Still too long at the smallest size? Cut the end so it never spills past the table.
    const maxChars = Math.max(2, Math.floor(roomW / (fontSize * CHAR_W) + 0.01)) // +0.01: rounding, not a real shortfall
    lines = lines.map((l) => shorten(l, maxChars))
  }

  // Invisible touch area: the table plus its chairs, never smaller than a fingertip on screen.
  const box = designTableBox({ ...table, x: 0, y: 0, rotation: 0 }, DESIGN_CHAIR_RADIUS)
  const minHit = MIN_TOUCH_PX / scale

  // Zoomed out the chairs are hidden, so one tiny icon per kind tells you the table has a special seat.
  const kinds = asTable.chairs.map((c) => c.kind)
  const badges = (['wheelchair', 'highchair'] as const).filter((k) => kinds.includes(k))
  const badgeR = 7 / scale // ~14px circle on screen
  const corner = (Math.max(width, height) / 2) * 0.75 // top-right of the table top
  const hitW = Math.max(box.maxX - box.minX, minHit)
  const hitH = Math.max(box.maxY - box.minY, minHit)

  return (
    <g transform={`translate(${table.x} ${table.y})`}>
      <g transform={`rotate(${table.rotation})`}>
        <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" />

        {showChairs &&
          chairPositions(asTable).map((p, i) => {
            const kind = asTable.chairs[i].kind
            const special = kind !== 'standard'
            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={special ? DESIGN_CHAIR_RADIUS * 1.15 : DESIGN_CHAIR_RADIUS}
                  fill={live ? live.chairFill(i) : kind === 'wheelchair' ? '#2E86DE' : kind === 'highchair' ? '#F4A300' : colors.chairFree}
                />
                {special && (
                  // Counter-rotate so the symbol stays upright however the table is turned.
                  <g transform={`rotate(${-table.rotation} ${p.x} ${p.y})`}>
                    <ChairKindIcon kind={kind} x={p.x} y={p.y} size={1.4} color={colors.white} />
                  </g>
                )}
              </g>
            )
          })}

        <g
          fill={look.fill}
          stroke={outline}
          strokeWidth={picked || selected ? Math.max(0.5, 3 / scale) : Math.max(0.25, (live?.dashed ? 2 : 1.2) / scale)}
          strokeDasharray={live?.dashed ? `${5 / scale} ${3 / scale}` : undefined}
        >
          {table.shape === 'circle' ? (
            <circle r={width / 2} />
          ) : (
            <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={0.4} />
          )}
        </g>
      </g>

      {showText && !showChairs &&
        badges.map((kind, i) => {
          const bx = corner + i * badgeR * 2.2
          const by = -corner
          return (
            <g key={kind} pointerEvents="none" aria-label={kind === 'wheelchair' ? 'has a wheelchair seat' : 'has a highchair'}>
              <circle cx={bx} cy={by} r={badgeR} fill={kind === 'wheelchair' ? '#2E86DE' : '#F4A300'} stroke={colors.white} strokeWidth={1.5 / scale} />
              <ChairKindIcon kind={kind} x={bx} y={by} size={badgeR * 1.5} color={colors.white} />
            </g>
          )
        })}

      {/* Spot-checked: a small, quiet check mark at the bottom-left of the table top. */}
      {showText && !showChairs && live?.checkedAt !== undefined && (
        <g pointerEvents="none" aria-label="checked against the floor">
          <circle cx={-corner} cy={corner} r={badgeR * 0.85} fill={colors.white} stroke="#8AA79A" strokeWidth={1.2 / scale} />
          <path
            d={`M ${-corner - badgeR * 0.4} ${corner} l ${badgeR * 0.3} ${badgeR * 0.3} l ${badgeR * 0.5} ${-badgeR * 0.55}`}
            fill="none"
            stroke="#3D8B5F"
            strokeWidth={2 / scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {/* Text is drawn outside the turned group so it always reads upright. */}
      {showText && (
        <g transform={textAngle ? `rotate(${textAngle})` : undefined}>
          {lines.map((line, i) => (
            <text
              key={i}
              y={(i - (lines.length - 1) / 2) * fontSize * 1.05}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={800}
              fill={look.text}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {line}
            </text>
          ))}
        </g>
      )}

      {showText && showChairs && (
        <text
          y={Math.max(box.maxY - box.minY, box.maxX - box.minX) / 2 + Math.max(1.2, MIN_TEXT_PX / scale)}
          textAnchor="middle"
          fontSize={Math.max(1.2, MIN_TEXT_PX / scale)}
          fontWeight={600}
          fill={colors.inkMuted}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {table.name}
        </text>
      )}
    </g>
  )
}

export default DesignTableShape
