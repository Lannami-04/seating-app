import type { Family } from '../types'

interface FamilyLegendProps {
  families: Family[]
  /** Family whose menu is open or which is being edited (highlighted). */
  activeFamilyId: string | null
  onSelect: (familyId: string) => void
}

/** Color key beside the table: one button per family. Tap one to edit or finish it. */
function FamilyLegend({ families, activeFamilyId, onSelect }: FamilyLegendProps) {
  if (families.length === 0) {
    return <p className="legend__empty">No one seated yet. Tap gray chairs, then press Done.</p>
  }
  return (
    <ul className="legend">
      {families.map((f) => (
        <li key={f.id}>
          <button
            className={f.id === activeFamilyId ? 'legend__item legend__item--active' : 'legend__item'}
            onClick={() => onSelect(f.id)}
          >
            <span className="legend__swatch" style={{ backgroundColor: f.color }} />
            <span className="legend__id">{f.id}</span>
            <span className="legend__count">
              {f.guestCount} {f.guestCount === 1 ? 'guest' : 'guests'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default FamilyLegend
