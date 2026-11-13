import type { Family } from '../types'

interface FamilyMenuProps {
  family: Family
  onEditChairs: () => void
  onDone: () => void
  onRemove: () => void
  onClose: () => void
}

/** Choices shown after tapping a family's color. */
function FamilyMenu({ family, onEditChairs, onDone, onRemove, onClose }: FamilyMenuProps) {
  return (
    <div className="family-menu">
      <div className="family-menu__title">
        <span className="legend__swatch" style={{ backgroundColor: family.color }} />
        Family {family.id} · {family.guestCount} {family.guestCount === 1 ? 'guest' : 'guests'}
      </div>
      <button className="btn btn--block" onClick={onEditChairs}>
        Edit chairs
      </button>
      <button className="btn btn--block btn--primary" onClick={onDone}>
        Mark done (free chairs)
      </button>
      <button className="btn btn--block btn--quiet-danger" onClick={onRemove}>
        Remove (entered by mistake)
      </button>
      <button className="btn btn--block btn--ghost" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export default FamilyMenu
