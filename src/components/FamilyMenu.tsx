import type { Family } from '../types'

interface FamilyMenuProps {
  family: Family
  /** Pick a new table (and chairs) for this family. */
  onMove: () => void
  /** Give the family one more chair (the closest free one), or null if the table has none free. */
  onAddSeat: (() => void) | null
  /** Take away the family's last chair (not possible with only one). */
  onRemoveSeat: (() => void) | null
  onEditChairs: () => void
  onDone: () => void
  onRemove: () => void
  onClose: () => void
  /** A change is being saved: buttons wait. */
  busy?: boolean
}

/** Choices shown after tapping a family's color: quick fixes first. */
function FamilyMenu({ family, onMove, onAddSeat, onRemoveSeat, onEditChairs, onDone, onRemove, onClose, busy }: FamilyMenuProps) {
  return (
    <div className="family-menu">
      <div className="family-menu__title">
        <span className="legend__swatch" style={{ backgroundColor: family.color }} />
        Family {family.id} · {family.guestCount} {family.guestCount === 1 ? 'guest' : 'guests'}
      </div>
      <button className="btn btn--block btn--primary" onClick={onMove} disabled={busy}>
        Move to another table
      </button>
      <div className="family-menu__row">
        <button
          className="btn"
          onClick={onRemoveSeat ?? undefined}
          disabled={!onRemoveSeat || busy}
          aria-label={`One chair fewer for family ${family.id}`}
        >
          − 1 seat
        </button>
        <span className="family-menu__count">{family.guestCount}</span>
        <button
          className="btn"
          onClick={onAddSeat ?? undefined}
          disabled={!onAddSeat || busy}
          aria-label={`One more chair for family ${family.id}`}
        >
          + 1 seat
        </button>
      </div>
      <button className="btn btn--block" onClick={onEditChairs} disabled={busy}>
        Pick chairs by hand
      </button>
      <button className="btn btn--block" onClick={onDone} disabled={busy}>
        They left (free the chairs)
      </button>
      <button className="btn btn--block btn--quiet-danger" onClick={onRemove} disabled={busy}>
        Remove (entered by mistake)
      </button>
      <button className="btn btn--block btn--ghost" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export default FamilyMenu
