import type { Reservation } from '../types'

interface ReservationPanelProps {
  reservation: Reservation
  tableNames: string[]
  onSeat: () => void
  /** Cancels a reservation, or releases a VIP / Big group hold. */
  onCancel: () => void
}

/** Shown beside a reserved or held table instead of the family list. */
function ReservationPanel({ reservation, tableNames, onSeat, onCancel }: ReservationPanelProps) {
  const seated = reservation.status === 'seated'
  const held = reservation.held === true
  return (
    <div className="res-panel">
      <div className={seated ? 'badge badge--seated' : 'badge'}>{seated ? 'Seated' : held ? 'Held' : 'Reserved'}</div>
      <h3 className="res-panel__name">{reservation.name}</h3>
      <p className="res-panel__info">
        Party of {reservation.partySize}
        <br />
        {tableNames.length === 1 ? 'Table' : 'Tables'} {tableNames.join(', ')}
      </p>
      <p className="res-panel__note">
        {held && !seated ? 'Held for this party from the layout. ' : ''}Walk-ins can’t use these chairs.
      </p>
      {!seated && (
        <>
          <button className="btn btn--block btn--primary btn--large" onClick={onSeat}>
            Seat party
          </button>
          <button className="btn btn--block btn--quiet-danger" onClick={onCancel}>
            {held ? 'Release table' : 'Cancel reservation'}
          </button>
        </>
      )}
    </div>
  )
}

export default ReservationPanel
