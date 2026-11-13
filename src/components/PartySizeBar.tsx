import { clamp } from '../logic/designTables'

interface PartySizeBarProps {
  /** Party size picked, or null when nothing is picked. */
  size: number | null
  onPick: (size: number | null) => void
  /** Result line, e.g. "Party of 4 → T12 · fills it up". */
  note: string
}

const QUICK = [1, 2, 3, 4, 5, 6, 7, 8]
const MAX = 30

/**
 * Faint row of party sizes along the bottom of the live floor. Tap a number and the best table glows;
 * tap it again to clear. "9+" turns into a −/+ for bigger parties.
 */
function PartySizeBar({ size, onPick, note }: PartySizeBarProps) {
  const big = size !== null && size > 8
  return (
    <div className={`party-bar${size !== null ? ' party-bar--active' : ''}`} role="group" aria-label="Suggest a table for a party of">
      <span className="party-bar__label">Seat a party of</span>
      {QUICK.map((n) => (
        <button
          key={n}
          className={`party-bar__num${size === n ? ' party-bar__num--on' : ''}`}
          onClick={() => onPick(size === n ? null : n)}
          aria-pressed={size === n}
        >
          {n}
        </button>
      ))}
      {big ? (
        <span className="party-bar__big">
          <button className="party-bar__num" onClick={() => onPick(size - 1 > 8 ? size - 1 : 8)} aria-label="Smaller party">
            −
          </button>
          <span className="party-bar__num party-bar__num--on">{size}</span>
          <button className="party-bar__num" onClick={() => onPick(clamp(size + 1, 9, MAX))} disabled={size >= MAX} aria-label="Bigger party">
            +
          </button>
        </span>
      ) : (
        <button className="party-bar__num" onClick={() => onPick(9)}>
          9+
        </button>
      )}
      {note && <span className="party-bar__note" role="status">{note}</span>}
    </div>
  )
}

export default PartySizeBar
