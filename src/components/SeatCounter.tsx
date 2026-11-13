interface SeatCounterProps {
  /** Empty chairs a walk-in can still be given. */
  open: number
  /** Guests sitting right now. */
  seated: number
}

/** The big "N seats open · M seated" counter in the live seating top bar. */
function SeatCounter({ open, seated }: SeatCounterProps) {
  return (
    <div className="counter" aria-live="polite">
      <div className="counter__main">
        <span className={open === 0 ? 'counter__spare--short' : open <= 5 ? 'counter__spare--low' : ''}>{open}</span> seats open
        <span className="counter__seated"> · {seated} seated</span>
      </div>
    </div>
  )
}

export default SeatCounter
