import { useState } from 'react'
import { clamp } from '../logic/designTables'

interface FloorSizeDialogProps {
  width: number
  height: number
  /** Smallest size that still keeps every table and room item on the floor. */
  minWidth: number
  minHeight: number
  onSave: (width: number, height: number) => void
  onCancel: () => void
}

const STEP = 10
const MAX = 800

/** One big −/+ control for a floor dimension. */
function SizeRow({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="field field--row">
      <span className="field__label">{label}</span>
      <div className="stepper">
        <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value - STEP, min, MAX))} disabled={value - STEP < min} aria-label={`Shorter ${label}`}>
          −
        </button>
        <span className="stepper__value floor-size__value">{value}</span>
        <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value + STEP, min, MAX))} disabled={value >= MAX} aria-label={`Longer ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

/** Make the floor longer or wider (or smaller, as long as nothing would fall off the edge). */
function FloorSizeDialog({ width, height, minWidth, minHeight, onSave, onCancel }: FloorSizeDialogProps) {
  const [w, setW] = useState(width)
  const [h, setH] = useState(height)

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-size-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave(w, h)
        }}
      >
        <h2 id="floor-size-title">Floor size</h2>
        <SizeRow label="Length (left to right)" value={w} min={minWidth} onChange={setW} />
        <SizeRow label="Depth (top to bottom)" value={h} min={minHeight} onChange={setH} />
        <p className="panel__hint">
          Grows to the right and downward; everything already placed stays where it is. Can't be made smaller than what's on the floor.
        </p>
        <div className="confirm__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

export default FloorSizeDialog
