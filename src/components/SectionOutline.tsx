import type { DesignSection, DesignTable } from '../types'
import { DESIGN_CHAIR_RADIUS, toTable } from '../logic/designTables'
import { tableBounds } from '../logic/geometry'

interface SectionOutlineProps {
  section: DesignSection
  tables: DesignTable[]
  /** Open in the side panel (editor): a little stronger. */
  selected?: boolean
}

/** How far the tint reaches past each table's chairs, in layout units. Close tables join into one area. */
const GLOW = 1.6

/**
 * A section on the floor: a soft tint hugging only its own tables, so nothing else gets covered.
 * Drawn before tables and room items, so it always sits behind them. The name is drawn by SectionLabels.
 */
function SectionOutline({ section, tables, selected = false }: SectionOutlineProps) {
  if (tables.length === 0) return null
  return (
    // One shared opacity for all shapes, so where they overlap the tint stays even (no dark patches).
    <g opacity={selected ? 0.34 : 0.22} fill={section.color} pointerEvents="none">
      {tables.map((t) => {
        const b = tableBounds(toTable({ ...t, x: 0, y: 0 }), DESIGN_CHAIR_RADIUS)
        const w = b.width + GLOW * 2
        const h = b.height + GLOW * 2
        return (
          <rect
            key={t.id}
            transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}
            x={b.minX - GLOW}
            y={b.minY - GLOW}
            width={w}
            height={h}
            rx={Math.min(w, h) / 2}
          />
        )
      })}
    </g>
  )
}

export default SectionOutline
