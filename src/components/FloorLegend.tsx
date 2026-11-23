import { colors } from '../theme'

/** A small dot in a fullness-glow color, like the glow around a table on the floor. */
function Glow({ color }: { color: string }) {
  return <span className="floor-legend__swatch floor-legend__swatch--glow" style={{ background: color }} />
}

/**
 * Key for the live floor: the glow around a table says how full it is (empty / some guests / 1–2 seats left),
 * a green table is full, a dashed yellow one is reserved.
 */
function FloorLegend() {
  return (
    <div className="floor-legend">
      <span className="floor-legend__item">
        <Glow color={colors.haloEmpty} /> Empty
      </span>
      <span className="floor-legend__item">
        <Glow color={colors.haloSome} /> Some guests
      </span>
      <span className="floor-legend__item">
        <Glow color={colors.haloAlmost} /> 1–2 left
      </span>
      <span className="floor-legend__item">
        <span className="floor-legend__swatch floor-legend__swatch--full" /> Full
      </span>
      <span className="floor-legend__item">
        <span className="floor-legend__swatch floor-legend__swatch--reserved" /> Reserved
      </span>
    </div>
  )
}

export default FloorLegend
