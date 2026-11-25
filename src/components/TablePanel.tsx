import { useState } from 'react'
import type { ChairKind, DesignSection, DesignTable, TableKind } from '../types'
import {
  CHAIR_KIND_CYCLE,
  EXACT_MAX,
  MAX_HIGHCHAIRS,
  SEAT_RULES,
  TABLE_KINDS,
  chairKindAt,
  clamp,
  exactSeatsProblem,
  seatRule,
  withExactSeats,
  withKind,
} from '../logic/designTables'
import ExactSeatsField from './ExactSeatsField'
import ChairKindIcon from './ChairKindIcon'
import RotateControl from './RotateControl'

interface TablePanelProps {
  table: DesignTable
  sections: DesignSection[]
  /** How many tables are in this table's big group (1 = on its own). */
  groupTableCount: number
  onChange: (changes: Partial<DesignTable>) => void
  /** Show the panel for this table's section (rename, color, pick tables). */
  onOpenSection: (sectionId: string) => void
  /** Make this many copies of the table next to it. Returns how many actually fit on the floor. */
  onCopy: (count: number) => number
  onDelete: () => void
  onDone: () => void
}

const KIND_NAMES: Record<ChairKind, string> = {
  standard: 'regular seat',
  wheelchair: 'wheelchair accessible',
  highchair: 'highchair',
}

/** Side panel for the selected table: seats, special seats, angle, section. */
function TablePanel({ table, sections, groupTableCount, onChange, onOpenSection, onCopy, onDelete, onDone }: TablePanelProps) {
  const rule = seatRule(table.shape, table.kind)
  const [copies, setCopies] = useState(1)
  const [copyNote, setCopyNote] = useState('')

  function changeKind(kind: TableKind) {
    // Seats stay within the new type's limits; back to Regular, the table gets its normal chairs back.
    const t = withKind(table, kind)
    onChange({ kind, seats: t.seats, normalSeats: t.normalSeats, chairKinds: t.chairKinds })
  }

  function setExactSeats(seats: number) {
    const t = withExactSeats(table, seats)
    onChange({ seats: t.seats, normalSeats: t.normalSeats })
  }

  function makeCopies() {
    const made = onCopy(copies)
    setCopyNote(
      made === copies
        ? `Added ${made} ${made === 1 ? 'copy' : 'copies'}.`
        : `Only ${made} of ${copies} fit on the floor. Move some tables or make the room items smaller.`,
    )
  }

  function changeSeats(delta: number) {
    const seats = clamp(table.seats + delta * rule.step, rule.min, rule.max)
    // Drop special-seat settings for seats that no longer exist.
    onChange({ seats, chairKinds: table.chairKinds.slice(0, seats) })
  }

  function cycleSeat(index: number) {
    const current = chairKindAt(table, index)
    const next = CHAIR_KIND_CYCLE[(CHAIR_KIND_CYCLE.indexOf(current) + 1) % CHAIR_KIND_CYCLE.length]
    const kinds = Array.from({ length: table.seats }, (_, i) => chairKindAt(table, i))
    kinds[index] = next
    onChange({ chairKinds: kinds })
  }

  return (
    <aside className="editor__panel" aria-label={`Table ${table.name}`}>
      <div className="panel__head">
        <h2>
          {table.name} <span className="panel__kind">· {SEAT_RULES[table.shape].label}</span>
        </h2>
        <div className="panel__head-actions">
          <button className="btn btn--danger" onClick={onDelete} aria-label="Delete this table">
            Delete
          </button>
          <button className="btn btn--primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      <section className="panel__group">
        <h3>Type</h3>
        <div className="segmented">
          {(Object.keys(TABLE_KINDS) as TableKind[]).map((k) => (
            <button
              key={k}
              className={`segmented__btn${table.kind === k ? ' segmented__btn--on' : ''}`}
              style={table.kind === k ? { background: TABLE_KINDS[k].fill, borderColor: TABLE_KINDS[k].stroke } : undefined}
              aria-pressed={table.kind === k}
              onClick={() => changeKind(k)}
            >
              {TABLE_KINDS[k].label}
            </button>
          ))}
        </div>
        {table.kind !== 'regular' && (
          <label className="field">
            <span className="field__label">{TABLE_KINDS[table.kind].namePrompt}</span>
            <input
              className="input input--wide"
              value={table.guestName}
              maxLength={30}
              placeholder={table.kind === 'vip' ? 'e.g. Mayor Kealoha' : 'e.g. Smith reunion'}
              onChange={(e) => onChange({ guestName: e.target.value })}
            />
            <span className="panel__hint">
              {table.kind === 'group'
                ? 'Shown on the table instead of the seat count. Leave empty to show the seat count.'
                : 'Shown on the table.'}
            </span>
          </label>
        )}
      </section>

      <section className="panel__group">
        <h3>{table.kind === 'regular' ? 'Seats' : 'Exact chairs'}</h3>
        {table.kind === 'regular' ? (
          <>
          <div className="stepper">
            <button className="btn btn--icon" onClick={() => changeSeats(-1)} disabled={table.seats <= rule.min} aria-label="Fewer seats">
              −
            </button>
            <span className="stepper__value">{table.seats}</span>
            <button className="btn btn--icon" onClick={() => changeSeats(1)} disabled={table.seats >= rule.max} aria-label="More seats">
              +
            </button>
          </div>
          {rule.step === 2 && <p className="panel__hint">Need an odd number? Switch the type to VIP or Big group.</p>}
          </>
        ) : (
          <>
            <ExactSeatsField
              value={table.seats}
              label="chairs at this table"
              check={(seats) => exactSeatsProblem(table.shape, seats)}
              onSet={setExactSeats}
            />
            <p className="panel__hint">
              Exactly this many chairs, odd numbers too. The table grows to fit them (round up to {EXACT_MAX.circle},
              long and square up to {EXACT_MAX.rectangle}). The party size, seated count and spare seats use this number.
              {table.kind === 'group' && groupTableCount > 1 && (
                <>
                  {' '}
                  This table is one of {groupTableCount} in its big group. To set the whole group's total, select all
                  its tables.
                </>
              )}
            </p>
          </>
        )}
        {table.normalSeats ? (
          <button className="btn btn--block" onClick={() => onChange({ seats: table.normalSeats ?? table.seats, normalSeats: null })}>
            Restore normal size ({table.normalSeats} chairs)
          </button>
        ) : null}
      </section>

      <section className="panel__group">
        <h3>Wheelchair accessible</h3>
        <p className="panel__hint">Tap a seat to mark it wheelchair accessible. It still counts as a normal seat and anyone can use it.</p>
        <div className="seat-chips">
          {Array.from({ length: table.seats }, (_, i) => {
            const kind = chairKindAt(table, i)
            return (
              <button
                key={i}
                className={`seat-chip seat-chip--${kind}`}
                onClick={() => cycleSeat(i)}
                aria-label={`Seat ${i + 1}: ${KIND_NAMES[kind]}`}
              >
                {kind === 'standard' ? (
                  i + 1
                ) : (
                  <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true">
                    <ChairKindIcon kind={kind} x={12} y={12} size={22} color="#fff" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel__group">
        <h3>Highchairs</h3>
        <div className="panel__row">
          <span className="panel__hint">Extra, beside the table: don't use a seat</span>
          <div className="stepper">
            <button
              className="btn btn--icon"
              onClick={() => onChange({ highchairs: clamp((table.highchairs ?? 0) - 1, 0, MAX_HIGHCHAIRS) })}
              disabled={(table.highchairs ?? 0) <= 0}
              aria-label="Fewer highchairs"
            >
              −
            </button>
            <span className="stepper__value">{table.highchairs ?? 0}</span>
            <button
              className="btn btn--icon"
              onClick={() => onChange({ highchairs: clamp((table.highchairs ?? 0) + 1, 0, MAX_HIGHCHAIRS) })}
              disabled={(table.highchairs ?? 0) >= MAX_HIGHCHAIRS}
              aria-label="More highchairs"
            >
              +
            </button>
          </div>
        </div>
      </section>

      <section className="panel__group">
        <h3>Angle</h3>
        <RotateControl value={table.rotation} onChange={(rotation) => onChange({ rotation })} />
      </section>

      <section className="panel__group">
        <h3>Section</h3>
        <div className="panel__row panel__row--gap">
          <select
            className="input input--grow"
            value={table.sectionId ?? ''}
            onChange={(e) => onChange({ sectionId: e.target.value || null })}
          >
            <option value="">No section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {table.sectionId && sections.some((s) => s.id === table.sectionId) && (
            <button className="btn" onClick={() => onOpenSection(table.sectionId ?? '')}>
              Open section
            </button>
          )}
        </div>
      </section>

      <section className="panel__group">
        <h3>Make copies</h3>
        <p className="panel__hint">Same type, shape, seats, angle and section, placed in empty spots nearby.</p>
        <div className="panel__row">
          <div className="stepper">
            <button className="btn btn--icon" onClick={() => setCopies(clamp(copies - 1, 1, 40))} disabled={copies <= 1} aria-label="Fewer copies">
              −
            </button>
            <span className="stepper__value">{copies}</span>
            <button className="btn btn--icon" onClick={() => setCopies(clamp(copies + 1, 1, 40))} disabled={copies >= 40} aria-label="More copies">
              +
            </button>
          </div>
          <button className="btn btn--primary" onClick={makeCopies}>
            Copy ×{copies}
          </button>
        </div>
        {copyNote && <p className="panel__hint" role="status">{copyNote}</p>}
      </section>

    </aside>
  )
}

export default TablePanel
