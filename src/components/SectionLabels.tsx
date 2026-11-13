import { useMemo } from 'react'
import type { RestaurantLayout } from '../types'
import { labelSize, sectionLabelSpot } from '../logic/designTables'

interface SectionLabelsProps {
  layout: RestaurantLayout
  /** Screen pixels per layout unit, so the name stays small but readable at any zoom. */
  scale: number
  /** Section ids to leave out (e.g. one being re-picked). */
  hiddenIds?: Set<string>
}

/** Zoom (pixels per layout unit) at which tables show their chairs and numbers ("T5") — same as the floors use. */
const NUMBERS_SHOW_AT = 12
/** Room left under a table for its number, only while numbers are showing. */
const NUMBER_ROOM = 2.2

/**
 * Every section's name, small, directly under that section's own tables
 * (the bottom-middle when that's snug under them, otherwise under its lowest table that has room).
 * Drawn on top so the whole name is always visible, and placed so it doesn't cover tables or room items.
 */
function SectionLabels({ layout, scale, hiddenIds }: SectionLabelsProps) {
  // Small: about 10px on screen when zoomed out, never smaller than 1.5 floor units when zoomed in.
  // Rounded so placement is only recalculated when the zoom changes noticeably, not on every frame.
  const font = Math.round(Math.max(1.5, 10 / scale) * 4) / 4
  const numbersShowing = scale >= NUMBERS_SHOW_AT
  const gap = numbersShowing ? NUMBER_ROOM : 0.2

  const spots = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const s of layout.sections) {
      const spot = sectionLabelSpot(layout, s.id, labelSize(s.name, font), gap)
      if (spot) map.set(s.id, spot)
    }
    return map
  }, [layout, font, gap])

  return (
    <g>
      {layout.sections.map((s) => {
        const spot = spots.get(s.id)
        if (!spot || hiddenIds?.has(s.id)) return null
        const { width, height } = labelSize(s.name, font)
        const hitH = Math.max(height, 44 / scale)
        return (
          <g key={s.id} data-section-id={s.id} style={{ cursor: 'pointer' }}>
            <rect x={spot.x - width / 2} y={spot.y - hitH / 2} width={width} height={hitH} fill="transparent" />
            <text
              x={spot.x}
              y={spot.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={font}
              fontWeight={800}
              letterSpacing={font * 0.04}
              fill={s.color}
              stroke="#fff"
              strokeWidth={font * 0.22}
              strokeLinejoin="round"
              paintOrder="stroke"
              style={{ userSelect: 'none', textTransform: 'uppercase' }}
            >
              {s.name}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export default SectionLabels
