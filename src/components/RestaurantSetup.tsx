import { useState } from 'react'
import { createRestaurant, toRemoteError } from '../state/remote'

interface RestaurantSetupProps {
  email: string
  onCreated: () => void
  onSignOut: () => void
}

/** First login with a new staff account: name the restaurant (this account becomes its owner). */
function RestaurantSetup({ email, onCreated, onSignOut }: RestaurantSetupProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  async function create() {
    setBusy(true)
    setError('')
    try {
      await createRestaurant(trimmed)
      onCreated()
    } catch (e) {
      setError(toRemoteError(e).message)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form
        className="auth__card"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) void create()
        }}
      >
        <h1>Set up your restaurant</h1>
        <p className="auth__hint">
          {email} isn't linked to a restaurant yet. Name it once; every tablet that logs in with this account will share
          its layouts and live seating.
        </p>
        <label className="field">
          <span className="field__label">Restaurant name</span>
          <input
            className="input input--wide"
            placeholder="e.g. Aloha Gardens"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
        </label>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--large" disabled={busy || !trimmed}>
          {busy ? 'Creating…' : 'Create restaurant'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          Log out
        </button>
      </form>
    </div>
  )
}

export default RestaurantSetup
