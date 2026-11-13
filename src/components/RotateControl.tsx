import { ROTATE_STEP, normalizeAngle } from '../logic/designTables'

interface RotateControlProps {
  /** Current angle in degrees (0..359). */
  value: number
  onChange: (degrees: number) => void
}

/** Turn buttons, a quick "stand up / lay down" 90° button, and a slider for any exact angle. */
function RotateControl({ value, onChange }: RotateControlProps) {
  const set = (deg: number) => onChange(normalizeAngle(deg))

  return (
    <div className="rotate">
      <div className="rotate__row">
        <button className="btn btn--icon" onClick={() => set(value - ROTATE_STEP)} aria-label={`Turn left ${ROTATE_STEP} degrees`}>
          ↺
        </button>
        <span className="rotate__value">{value}°</span>
        <button className="btn btn--icon" onClick={() => set(value + ROTATE_STEP)} aria-label={`Turn right ${ROTATE_STEP} degrees`}>
          ↻
        </button>
        <button className="btn" onClick={() => set(value + 90)}>
          Turn 90°
        </button>
      </div>
      <input
        className="rotate__slider"
        type="range"
        min={0}
        max={359}
        step={1}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        aria-label="Angle"
      />
    </div>
  )
}

export default RotateControl
