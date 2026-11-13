/** Small key explaining the two table colors: green = full, yellow = reserved. */
function FloorLegend() {
  return (
    <div className="floor-legend">
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
