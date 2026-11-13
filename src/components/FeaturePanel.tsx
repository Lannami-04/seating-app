import { useState } from 'react'
import type { DesignFeature } from '../types'
import { FEATURE_PRESETS, clamp } from '../logic/designTables'
import RotateControl from './RotateControl'

interface FeaturePanelProps {
  feature: DesignFeature
  onChange: (changes: Partial<DesignFeature>) => void
  /** Make this many copies beside it. Returns how many actually fit. */
  onCopy: (count: number) => number
  onDelete: () => void
  onDone: () => void
}

/** One −/+ size control (width or length). */
function SizeStepper({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="panel__row">
      <span className="panel__row-label">{label}</span>
      <div className="stepper">
        <button className="btn btn--icon" onClick={() => onChange(clamp(value - 1, min, 80))} disabled={value <= min} aria-label={`Smaller ${label}`}>
          −
        </button>
        <span className="stepper__value">{value}</span>
        <button className="btn btn--icon" onClick={() => onChange(clamp(value + 1, min, 80))} aria-label={`Bigger ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

/** Side panel for a selected stage, divider, bar, buffet or entrance. */
function FeaturePanel({ feature, onChange, onCopy, onDelete, onDone }: FeaturePanelProps) {
  const [copies, setCopies] = useState(1)
  const [copyNote, setCopyNote] = useState('')
  const kindName = FEATURE_PRESETS[feature.kind].label
  const thinMin = feature.kind === 'divider' ? 0.8 : 1

  return (
    <aside className="editor__panel" aria-label={kindName}>
      <div className="panel__head">
        <h2>{kindName}</h2>
        <div className="panel__head-actions">
          <button className="btn btn--danger" onClick={onDelete} aria-label="Delete this item">
            Delete
          </button>
          <button className="btn btn--primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      {feature.kind !== 'divider' && (
        <section className="panel__group">
          <h3>Label</h3>
          <input
            className="input input--wide"
            value={feature.label}
            maxLength={24}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="No label"
          />
        </section>
      )}

      <section className="panel__group">
        <h3>Size</h3>
        <SizeStepper label="Length" value={feature.width} min={2} onChange={(width) => onChange({ width })} />
        <SizeStepper
          label="Depth"
          value={feature.height}
          min={thinMin}
          onChange={(height) => onChange({ height: Math.max(thinMin, Math.round(height)) })}
        />
      </section>

      <section className="panel__group">
        <h3>Angle</h3>
        <RotateControl value={feature.rotation} onChange={(rotation) => onChange({ rotation })} />
      </section>

      <section className="panel__group">
        <h3>Make copies</h3>
        <p className="panel__hint">Same size and angle, placed side by side next to it.</p>
        <div className="panel__row">
          <div className="stepper">
            <button className="btn btn--icon" onClick={() => setCopies(clamp(copies - 1, 1, 20))} disabled={copies <= 1} aria-label="Fewer copies">
              −
            </button>
            <span className="stepper__value">{copies}</span>
            <button className="btn btn--icon" onClick={() => setCopies(clamp(copies + 1, 1, 20))} disabled={copies >= 20} aria-label="More copies">
              +
            </button>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => {
              const made = onCopy(copies)
              setCopyNote(made === copies ? `Added ${made} ${made === 1 ? 'copy' : 'copies'}.` : `Only ${made} of ${copies} fit. Move things or turn it and try again.`)
            }}
          >
            Copy ×{copies}
          </button>
        </div>
        {copyNote && (
          <p className="panel__hint" role="status">
            {copyNote}
          </p>
        )}
      </section>
    </aside>
  )
}

export default FeaturePanel
