import { useState } from 'react'
import type { TableKind, TableShape } from '../types'
import { SEAT_RULES, TABLE_KINDS, clamp, seatRule } from '../logic/designTables'

/** Everything chosen in the dialog. Also remembered so the next "+ Table" starts with the same choices. */
export interface NewTableChoice {
  kind: TableKind
  shape: TableShape
  seats: number
  guestName: string
  /** How many identical tables to make. */
  count: number
}

interface NewTableDialogProps {
  initial: NewTableChoice
  onCreate: (choice: NewTableChoice) => void
  onCancel: () => void
}

const MAX_COUNT = 40

/** A big −/+ number control. */
function Stepper({ value, min, max, step = 1, label, onChange }: { value: number; min: number; max: number; step?: number; label: string; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value - step, min, max))} disabled={value <= min} aria-label={`Fewer ${label}`}>
        −
      </button>
      <span className="stepper__value">{value}</span>
      <button type="button" className="btn btn--icon" onClick={() => onChange(clamp(value + step, min, max))} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
    </div>
  )
}

/** Asks what kind of table to add (regular, VIP, big group), its shape, how many people, and how many tables. */
function NewTableDialog({ initial, onCreate, onCancel }: NewTableDialogProps) {
  const [choice, setChoice] = useState<NewTableChoice>(initial)
  const rule = seatRule(choice.shape, choice.kind)

  /** Changing type or shape keeps the seat count if it's still allowed, otherwise snaps it into range. */
  function update(changes: Partial<NewTableChoice>) {
    const next = { ...choice, ...changes }
    const r = seatRule(next.shape, next.kind)
    let seats = clamp(next.seats, r.min, r.max)
    if (r.step === 2 && seats % 2 !== 0) seats = Math.min(r.max, seats + 1)
    setChoice({ ...next, seats })
  }

  const look = TABLE_KINDS[choice.kind]
  const needsName = choice.kind === 'vip'

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="confirm new-table"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-table-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onCreate({ ...choice, guestName: choice.guestName.trim() })
        }}
      >
        <h2 id="new-table-title">Add tables</h2>

        <div className="field">
          <span className="field__label">Type</span>
          <div className="segmented">
            {(Object.keys(TABLE_KINDS) as TableKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`segmented__btn${choice.kind === k ? ' segmented__btn--on' : ''}`}
                style={choice.kind === k ? { background: TABLE_KINDS[k].fill, borderColor: TABLE_KINDS[k].stroke } : undefined}
                aria-pressed={choice.kind === k}
                onClick={() => update({ kind: k })}
              >
                {TABLE_KINDS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Shape</span>
          <div className="segmented">
            {(Object.keys(SEAT_RULES) as TableShape[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`segmented__btn${choice.shape === s ? ' segmented__btn--on' : ''}`}
                aria-pressed={choice.shape === s}
                onClick={() => update({ shape: s })}
              >
                {SEAT_RULES[s].label}
              </button>
            ))}
          </div>
        </div>

        {choice.kind !== 'regular' && (
          <label className="field">
            <span className="field__label">{look.namePrompt}</span>
            <input
              className="input input--wide"
              value={choice.guestName}
              maxLength={30}
              placeholder={choice.kind === 'vip' ? 'e.g. Mayor Kealoha' : 'e.g. Smith reunion'}
              onChange={(e) => setChoice({ ...choice, guestName: e.target.value })}
            />
          </label>
        )}

        <div className="field field--row">
          <span className="field__label">People per table</span>
          <Stepper value={choice.seats} min={rule.min} max={rule.max} step={rule.step} label="seats" onChange={(seats) => update({ seats })} />
        </div>

        <div className="field field--row">
          <span className="field__label">How many tables</span>
          <Stepper value={choice.count} min={1} max={MAX_COUNT} label="tables" onChange={(count) => setChoice({ ...choice, count })} />
        </div>

        <p className="panel__hint">
          {choice.count} {look.label.toLowerCase()} {choice.count === 1 ? 'table' : 'tables'} × {choice.seats} = {choice.count * choice.seats} seats
        </p>

        <div className="confirm__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={needsName && !choice.guestName.trim()}>
            Add {choice.count === 1 ? 'table' : `${choice.count} tables`}
          </button>
        </div>
      </form>
    </div>
  )
}

export default NewTableDialog
