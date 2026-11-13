import type { ChairKind } from '../types'

interface ChairKindIconProps {
  kind: ChairKind
  /** Center of the icon, in the parent SVG's units. */
  x: number
  y: number
  size: number
  color: string
}

/** Small wheelchair / highchair symbol drawn inside an SVG. Draws nothing for standard chairs. */
function ChairKindIcon({ kind, x, y, size, color }: ChairKindIconProps) {
  if (kind === 'standard') return null
  // The paths below are drawn in a 24x24 box, then scaled down to `size`.
  return (
    <g
      transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`}
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    >
      {kind === 'wheelchair' ? (
        <>
          <circle cx={11} cy={3.5} r={2} fill={color} stroke="none" />
          <path d="M11 7v6h6l2.5 5.5" />
          <path d="M7.5 10.5a6 6 0 1 0 8.5 7" />
        </>
      ) : (
        <>
          <path d="M8 2v10h8" />
          <path d="M13 7h6" />
          <path d="M8 12l-2.5 10M16 12l2.5 10" />
          <path d="M7 17.5h10" />
        </>
      )}
    </g>
  )
}

export default ChairKindIcon
