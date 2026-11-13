import type { Chair as ChairData } from '../types'
import ChairKindIcon from './ChairKindIcon'

interface ChairProps { // give props' shape a name
  chair: ChairData
  /** Center of the chair inside the detail view's SVG. */
  x: number
  y: number
  radius: number
  color: string
  textColor: string
  /** Picked for the family being created or edited. */
  isSelected: boolean
  /** Tapping does nothing (e.g. the table is reserved). */
  disabled: boolean
  description: string
  onTap: () => void
}

/**
 * One big tappable chair in the table detail view.
 * The chair doesn't remember anything itself: the parent (TableDetail) owns the state and
 * tells each chair its color and what to do when tapped. That's "lifting state up".
 */
function Chair({ chair, x, y, radius, color, textColor, isSelected, disabled, description, onTap }: ChairProps) {
  const hasIcon = chair.kind !== 'standard'
  return (
    <g
      className={disabled ? 'chair chair--disabled' : 'chair'}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={description}
      aria-pressed={isSelected}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onTap}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onTap()
        }
      }}
    >
      <circle cx={x} cy={y} r={radius} fill={color} />
      {isSelected && <circle cx={x} cy={y} r={radius + 0.12} fill="none" stroke="#1F2933" strokeWidth={0.22} />}
      {hasIcon && <ChairKindIcon kind={chair.kind} x={x} y={y - radius * 0.28} size={radius * 0.9} color={textColor} />}
      <text
        x={x}
        y={hasIcon ? y + radius * 0.5 : y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={hasIcon ? radius * 0.5 : radius * 0.75}
        fill={textColor}
        pointerEvents="none"
        className="chair__number"
      >
        {chair.number}
      </text>
    </g>
  )
}

export default Chair // make it reusable elsewhere
