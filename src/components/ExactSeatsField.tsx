import { useState } from 'react'

interface ExactSeatsFieldProps {
  /** The number of chairs now. */
  value: number
  /** Why a number isn't allowed (shown under the box), or null if it's fine. */
  check: (seats: number) => string | null
  onSet: (seats: number) => void
  /** Read out by screen readers, e.g. "chairs at this table". */
  label: string
}

/**
 * Type an exact number of chairs (then Enter or "Set"), or nudge it with − / +.
 * A number that isn't allowed is not saved; a message says why.
 */
function ExactSeatsField({ value, check, onSet, label }: ExactSeatsFieldProps) {
  const [text, setText] = useState(String(value))
  const [problem, setProblem] = useState('')
  // When the number changes somewhere else (Undo, another panel), show the new one.
  // (Updating state while rendering is React's way to "reset when a prop changes"; no effect needed.)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
    setProblem('')
  }

  function trySet(seats: number) {
    const why = check(seats)
    if (why) {
      setProblem(why)
      return
    }
    setProblem('')
    // Show the current number again; if the change is saved, the new number comes in as `value` right after.
    setText(String(value))
    if (seats !== value) onSet(seats)
  }

  return (
    <form
      className="exact-seats"
      onSubmit={(e) => {
        e.preventDefault()
        trySet(Number(text))
      }}
    >
      <div className="panel__row panel__row--gap">
        <button type="button" className="btn btn--icon" onClick={() => trySet(value - 1)} aria-label={`One fewer: ${label}`}>
          −
        </button>
        <input
          className="input exact-seats__input"
          type="number"
          inputMode="numeric"
          min={1}
          value={text}
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value)
            setProblem('')
          }}
        />
        <button type="button" className="btn btn--icon" onClick={() => trySet(value + 1)} aria-label={`One more: ${label}`}>
          +
        </button>
        <button type="submit" className="btn" disabled={text === String(value)}>
          Set
        </button>
      </div>
      {problem && (
        <p className="exact-seats__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  )
}

export default ExactSeatsField
