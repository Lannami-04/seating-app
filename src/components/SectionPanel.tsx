import type { DesignSection, DesignTable } from '../types'
import { SECTION_COLORS, looksLikeAny, totalSeats } from '../logic/designTables'

interface SectionPanelProps {
  section: DesignSection
  tables: DesignTable[]
  /** Colors other sections already have: they can't be picked here. */
  usedColors: string[]
  onChange: (changes: Partial<DesignSection>) => void
  onEditTables: () => void
  onRemove: () => void
  /** Select all of this section's tables at once (to move, copy, delete... them together). */
  onSelectTables: () => void
  onDone: () => void
}

/** Side panel for a selected section: rename, recolor, change which tables are in it. */
function SectionPanel({ section, tables, usedColors, onChange, onEditTables, onRemove, onSelectTables, onDone }: SectionPanelProps) {
  return (
    <aside className="editor__panel" aria-label={`Section ${section.name}`}>
      <div className="panel__head">
        <h2>Section</h2>
        <button className="btn btn--primary" onClick={onDone}>
          Done
        </button>
      </div>

      <section className="panel__group">
        <h3>Name</h3>
        <input className="input input--wide" value={section.name} maxLength={24} onChange={(e) => onChange({ name: e.target.value })} />
      </section>

      <section className="panel__group">
        <h3>Color</h3>
        <p className="panel__hint">Each section gets its own color. Crossed-out colors are used by (or look too much like) another section.</p>
        <div className="swatches">
          {SECTION_COLORS.map((c) => {
            const taken = looksLikeAny(c, usedColors) // same as, or looks too much like, another section's color
            return (
              <button
                key={c}
                className={`swatch${c === section.color ? ' swatch--active' : ''}${taken ? ' swatch--taken' : ''}`}
                style={{ background: c }}
                onClick={() => onChange({ color: c })}
                disabled={taken}
                aria-label={taken ? `Color ${c}, too much like another section` : `Color ${c}`}
                aria-pressed={c === section.color}
              />
            )
          })}
        </div>
      </section>

      <section className="panel__group">
        <h3>Tables</h3>
        <p className="panel__hint">
          {tables.length} {tables.length === 1 ? 'table' : 'tables'} · {totalSeats(tables)} seats
          {tables.length > 0 && `: ${tables.map((t) => t.name).join(', ')}`}
        </p>
        <div className="panel__row panel__row--gap">
          <button className="btn input--grow" onClick={onEditTables}>
            Edit tables
          </button>
          <button className="btn input--grow" onClick={onSelectTables} disabled={tables.length === 0}>
            Select them all
          </button>
        </div>
      </section>

      <button className="btn btn--quiet-danger btn--block" onClick={onRemove}>
        Remove section (tables stay)
      </button>
    </aside>
  )
}

export default SectionPanel
