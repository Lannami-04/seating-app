import type { DesignFeature } from '../types'
import { FEATURE_PRESETS } from '../logic/designTables'
import { colors } from '../theme'

interface DesignFeatureShapeProps {
  feature: DesignFeature
  selected?: boolean
  showLabel?: boolean
  /** Screen pixels per layout unit, so thin dividers stay easy to grab and labels stay readable. */
  scale?: number
}

/** Draws a stage, divider, bar, buffet or entrance, turned to its angle. */
function DesignFeatureShape({ feature, selected = false, showLabel = true, scale = 10 }: DesignFeatureShapeProps) {
  const preset = FEATURE_PRESETS[feature.kind]
  const { width, height } = feature
  // Dividers never show a label (it only takes up space); very thin items have no room for one either.
  const hasLabel = showLabel && feature.kind !== 'divider' && Math.min(width, height) >= 2 && feature.label.trim() !== ''
  const fitted = Math.min(2.4, height * 0.4, width / Math.max(4, feature.label.length * 0.7))
  const fontSize = Math.max(fitted, 11 / scale)
  // Touch area at least a fingertip (48px) in each direction.
  const hitW = Math.max(width + 2, 48 / scale)
  const hitH = Math.max(height + 2, 48 / scale)

  return (
    <g transform={`translate(${feature.x} ${feature.y}) rotate(${feature.rotation})`}>
      {/* Wider invisible hit area so thin dividers are still easy to grab. */}
      <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" />
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={Math.min(0.6, height / 2)}
        fill={preset.fill}
        stroke={selected ? colors.selection : 'none'}
        strokeWidth={0.5}
        strokeDasharray={feature.kind === 'entrance' ? '1 0.6' : undefined}
      />
      {hasLabel && (
        <text
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={700}
          letterSpacing={0.1}
          fill={preset.text}
          style={{ pointerEvents: 'none', userSelect: 'none', textTransform: 'uppercase' }}
        >
          {feature.label}
        </text>
      )}
    </g>
  )
}

export default DesignFeatureShape
