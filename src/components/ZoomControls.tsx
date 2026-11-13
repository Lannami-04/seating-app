interface ZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  /** When given, a "Sections" on/off button is shown above the zoom buttons. */
  sectionsOn?: boolean
  onToggleSections?: () => void
}

/** +, − and "fit" buttons (for people without pinch), plus an optional sections on/off switch. */
function ZoomControls({ onZoomIn, onZoomOut, onFit, sectionsOn, onToggleSections }: ZoomControlsProps) {
  return (
    <div className="zoom">
      {onToggleSections && (
        <button
          className={`btn zoom__sections${sectionsOn ? ' btn--on' : ''}`}
          onClick={onToggleSections}
          aria-pressed={sectionsOn}
          title={sectionsOn ? 'Hide section colors and names' : 'Show section colors and names'}
        >
          Sections
        </button>
      )}
      <button className="btn btn--icon" onClick={onZoomIn} aria-label="Zoom in">
        +
      </button>
      <button className="btn btn--icon" onClick={onZoomOut} aria-label="Zoom out">
        −
      </button>
      <button className="btn btn--icon zoom__fit" onClick={onFit} aria-label="Show whole floor">
        ⤢
      </button>
    </div>
  )
}

export default ZoomControls
