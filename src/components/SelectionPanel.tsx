import { useState } from 'react'
import type { DesignFeature, DesignSection, DesignTable, TableKind } from '../types'
import { TABLE_KINDS, byTableName, splitGroupSeats, totalSeats } from '../logic/designTables'
import ExactSeatsField from './ExactSeatsField'

export type Arrangement = 'row' | 'column' | 'even'

interface SelectionPanelProps {
  tables: DesignTable[]
  features: DesignFeature[]
  sections: DesignSection[]
  onDelete: () => void
  onDone: () => void
  onSection: (sectionId: string | null) => void
  onNewSection: (name: string) => void
  onKind: (kind: TableKind) => void
  /** Same name on every selected VIP / big group table (one party across several tables). */
  onName: (name: string) => void
  /** Add or remove one seat (or two on long tables) at every selected table, within each table's limits. */
  onSeats: (delta: 1 | -1) => void
  /** Every table of the one big group the selection is (empty if the selection isn't a single big group). */
  groupTables: DesignTable[]
  /** Give that big group exactly this many seats in total (chairs come off the last table). */
  onGroupSeats: (total: number) => void
  /** Put the normal chairs back on every selected table that has an exact chair count. */
  onRestoreSeats: () => void
  /** Turn each selected thing in place by this many degrees. */
  onTurn: (degrees: number) => void
  onArrange: (how: Arrangement) => void
  /** Copy the whole group (tables and room items) next to itself. Returns false if there's no room. */
  onCopy: () => boolean
}

/** Side panel when many things are selected: act on all of them at once. */
function SelectionPanel(props: SelectionPanelProps) {
  const { tables, features, sections, onDelete, onDone, onSection, onNewSection, onKind, onName, onSeats, onTurn, onArrange, onCopy } = props
  const { groupTables, onGroupSeats, onRestoreSeats } = props
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState('')
  const count = tables.length + features.length
  const hasTables = tables.length > 0

  // If every selected table shares a type / section, show it as chosen.
  // VIP / big group tables can carry a name; show it if they all share one.
  const named = tables.filter((t) => t.kind !== 'regular')
  const sharedName = named.length > 0 && named.every((t) => t.guestName === named[0].guestName) ? named[0].guestName : null
  const sharedKind = hasTables && tables.every((t) => t.kind === tables[0].kind) ? tables[0].kind : null
  const sharedSection = hasTables && tables.every((t) => t.sectionId === tables[0].sectionId) ? (tables[0].sectionId ?? '') : null

  const trimmed = tables.filter((t) => t.normalSeats)
  const groupNames = [...groupTables].sort(byTableName).map((t) => t.name)

  const parts: string[] = []
  if (hasTables) parts.push(`${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${totalSeats(tables)} seats`)
  if (features.length > 0) parts.push(`${features.length} room ${features.length === 1 ? 'item' : 'items'}`)

  return (
    <aside className="editor__panel" aria-label="Selected items">
      <div className="panel__head">
        <h2>{count} selected</h2>
        <div className="panel__head-actions">
          <button className="btn btn--danger" onClick={onDelete} disabled={count === 0}>
            Delete
          </button>
          <button className="btn btn--primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      <p className="panel__hint">
        {count === 0 ? 'Tap tables to select them.' : parts.join(' · ')}
        <br />
        Tap to add or remove · hold empty floor and drag to select an area · drag any selected table to move them all.
        {count > 1 && (
          <>
            <br />
            <strong>Bigger or smaller:</strong> drag the round handle at the bottom-right corner of the dashed box. Everything
            spreads out or moves closer together. Tables keep their real size, while stage, bar and dividers resize along.
          </>
        )}
      </p>

      {hasTables && (
        <section className="panel__group">
          <h3>Section</h3>
          <select className="input input--wide" value={sharedSection ?? 'mixed'} onChange={(e) => onSection(e.target.value || null)}>
            {sharedSection === null && (
              <option value="mixed" disabled>
                Mixed sections
              </option>
            )}
            <option value="">No section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <form
            className="panel__row panel__row--gap"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim()) return
              onNewSection(newName.trim())
              setNewName('')
            }}
          >
            <input className="input input--grow" placeholder="New section, e.g. Hibiscus" value={newName} maxLength={24} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" type="submit" disabled={!newName.trim()}>
              Make
            </button>
          </form>
        </section>
      )}

      {hasTables && (
        <section className="panel__group">
          <h3>Type</h3>
          <div className="segmented">
            {(Object.keys(TABLE_KINDS) as TableKind[]).map((k) => (
              <button
                key={k}
                className={`segmented__btn${sharedKind === k ? ' segmented__btn--on' : ''}`}
                style={sharedKind === k ? { background: TABLE_KINDS[k].fill, borderColor: TABLE_KINDS[k].stroke } : undefined}
                aria-pressed={sharedKind === k}
                onClick={() => onKind(k)}
              >
                {TABLE_KINDS[k].label}
              </button>
            ))}
          </div>
          {sharedKind === 'group' && (
            <p className="panel__hint">
              Tapping Big group makes the selected tables ONE group: during service they are one party, with one
              name across them, and seating any of them seats them all.
            </p>
          )}
          {named.length > 0 && (
            <label className="field">
              <span className="field__label">
                Name on {named.length === 1 ? 'the VIP / big group table' : `all ${named.length} VIP / big group tables`}
              </span>
              <input
                className="input input--wide"
                value={sharedName ?? ''}
                placeholder={sharedName === null ? 'Different names — type to give them all one name' : 'e.g. Smith reunion'}
                maxLength={30}
                onChange={(e) => onName(e.target.value)}
              />
            </label>
          )}
        </section>
      )}

      {groupTables.length > 0 && (
        <section className="panel__group">
          <h3>Exact seats for this big group</h3>
          <ExactSeatsField
            value={totalSeats(groupTables)}
            label="seats for the whole big group"
            check={(total) => {
              const result = splitGroupSeats(groupTables, total)
              return 'problem' in result ? result.problem : null
            }}
            onSet={onGroupSeats}
          />
          <p className="panel__hint">
            Exactly this many seats across {groupNames.join(', ')}, odd numbers too. Tables keep their normal size in
            order and chairs come off the last table ({groupNames[groupNames.length - 1]}).
          </p>
        </section>
      )}

      {trimmed.length > 0 && (
        <section className="panel__group">
          <h3>Normal size</h3>
          <button className="btn btn--block" onClick={onRestoreSeats}>
            Restore normal size ({trimmed.length <= 3 ? trimmed.map((t) => `${t.name}: ${t.normalSeats}`).join(', ') : `${trimmed.length} tables`})
          </button>
        </section>
      )}

      {hasTables && (
        <section className="panel__group">
          <h3>Seats at every table</h3>
          <div className="panel__row panel__row--gap">
            <button className="btn btn--icon" onClick={() => onSeats(-1)} aria-label="One fewer seat at each table">
              −
            </button>
            <span className="panel__hint">one less / one more at each</span>
            <button className="btn btn--icon" onClick={() => onSeats(1)} aria-label="One more seat at each table">
              +
            </button>
          </div>
        </section>
      )}

      {count > 0 && (
        <section className="panel__group">
          <h3>Turn each</h3>
          <div className="panel__row panel__row--gap">
            <button className="btn btn--icon" onClick={() => onTurn(-15)} aria-label="Turn each left 15 degrees">
              ↺
            </button>
            <button className="btn btn--icon" onClick={() => onTurn(15)} aria-label="Turn each right 15 degrees">
              ↻
            </button>
            <button className="btn" onClick={() => onTurn(90)}>
              Turn 90°
            </button>
          </div>
        </section>
      )}

      {count > 1 && (
        <section className="panel__group">
          <h3>Line up</h3>
          <div className="segmented">
            <button className="segmented__btn" onClick={() => onArrange('row')}>
              In a row
            </button>
            <button className="segmented__btn" onClick={() => onArrange('column')}>
              In a column
            </button>
            <button className="segmented__btn" onClick={() => onArrange('even')} disabled={count < 3}>
              Even gaps
            </button>
          </div>
        </section>
      )}

      {count > 0 && (
        <section className="panel__group">
          <h3>Copy</h3>
          <button
            className="btn btn--block"
            onClick={() => setNote(onCopy() ? 'Copied. The new copy is now selected — drag it where you want.' : 'No free space beside this group. Move things or zoom out and try again.')}
          >
            Copy these beside them
          </button>
          {note && (
            <p className="panel__hint" role="status">
              {note}
            </p>
          )}
        </section>
      )}
    </aside>
  )
}

export default SelectionPanel
