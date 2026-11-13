import { useState } from 'react'

interface ReservationBarProps {
  /** Names of the tables tapped so far, e.g. ["A1", "A2"]. */
  tableNames: string[]
  seatTotal: number
  onSave: (name: string, partySize: number) => void
  onCancel: () => void
}

/** Shown in the top bar while creating a reservation. Tables are picked by tapping the floor plan. */
function ReservationBar({ tableNames, seatTotal, onSave, onCancel }: ReservationBarProps) {
  const [name, setName] = useState('')
  // null = "use all seats on the chosen tables" until staff change the number.
  const [partyOverride, setPartyOverride] = useState<number | null>(null)

  const partySize = Math.max(1, Math.min(partyOverride ?? seatTotal, seatTotal))
  const canSave = name.trim().length > 0 && tableNames.length > 0

  return (
    <form
      className="resbar"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave(name, partySize)
      }}
    >
      {/* Fixed width, so the bar (and the floor below it) never jumps while tables are being tapped. */}
      <div className="resbar__tables" title={tableNames.join(', ')}>
        {tableNames.length === 0
          ? 'Tap tables to reserve'
          : tableNames.length <= 3
            ? `${tableNames.join(', ')} · ${seatTotal} seats`
            : `${tableNames.length} tables · ${seatTotal} seats`}
      </div>
      <input
        className="input"
        placeholder="Party name"
        aria-label="Party name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="stepper" aria-label="Party size">
        <button type="button" className="btn btn--icon" onClick={() => setPartyOverride(partySize - 1)} disabled={partySize <= 1}>
          −
        </button>
        <span className="stepper__value">{tableNames.length ? partySize : '–'}</span>
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setPartyOverride(partySize + 1)}
          disabled={partySize >= seatTotal}
        >
          +
        </button>
      </div>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn btn--primary" disabled={!canSave}>
        Reserve
      </button>
    </form>
  )
}

export default ReservationBar
