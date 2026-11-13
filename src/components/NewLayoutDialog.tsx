import { useState } from 'react'

interface NewLayoutDialogProps {
  onCreate: (name: string) => void
  onCancel: () => void
}

/** Pops up after tapping "+": asks for the restaurant layout's name. */
function NewLayoutDialog({ onCreate, onCancel }: NewLayoutDialogProps) {
  const [name, setName] = useState('')
  const trimmed = name.trim()

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-layout-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault() // stop the browser from reloading the page
          if (trimmed) onCreate(trimmed)
        }}
      >
        <h2 id="new-layout-title">Name your restaurant</h2>
        <input
          className="input input--wide"
          placeholder="e.g. Main dining room"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoFocus
        />
        <div className="confirm__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!trimmed}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

export default NewLayoutDialog
