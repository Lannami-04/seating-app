import { useState } from 'react'
import { supabase } from '../lib/supabase'

/** Email + password login with the restaurant's staff account (Supabase Auth). */
function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function logIn() {
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(
        /invalid login credentials/i.test(error.message)
          ? 'Wrong email or password.'
          : /fetch|network/i.test(error.message)
            ? "Couldn't reach the server. Check the Wi-Fi and try again."
            : error.message,
      )
    }
    // On success useSession() notices the new login and the app opens by itself.
  }

  return (
    <div className="auth">
      <form
        className="auth__card"
        onSubmit={(e) => {
          e.preventDefault() // stop the browser from reloading the page
          void logIn()
        }}
      >
        <h1>Seating</h1>
        <p className="auth__hint">Log in with your restaurant's staff account.</p>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input input--wide"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input input--wide"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--large" disabled={busy || !email.trim() || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  )
}

export default LoginScreen
