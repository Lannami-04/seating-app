import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'
import { useSession } from './state/useSession'
import { fetchMyRestaurant, toRemoteError, type Restaurant } from './state/remote'
import LoginScreen from './components/LoginScreen'
import RestaurantSetup from './components/RestaurantSetup'
import RestaurantApp from './components/RestaurantApp'

/**
 * The top of the app. Before showing any screen it makes sure of three things:
 *   1. the app knows which database to use (.env.local),
 *   2. someone is logged in (Supabase Auth, email + password),
 *   3. that login belongs to a restaurant (first login: name the restaurant).
 * Then RestaurantApp shows the home menu, layout editor and live seating.
 */
function App() {
  if (!supabase) {
    return (
      <div className="auth">
        <div className="auth__card">
          <h1>Database not set up</h1>
          <p className="auth__hint">
            Copy <code>.env.example</code> to <code>.env.local</code>, fill in VITE_SUPABASE_URL and
            VITE_SUPABASE_PUBLISHABLE_KEY, then restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }
  return <LoggedInGate />
}

function LoggedInGate() {
  const { session, loading } = useSession()
  if (loading) return <div className="auth">Loading…</div>
  if (!session) return <LoginScreen />
  // key: a different login starts completely fresh.
  return <RestaurantGate key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />
}

const signOut = () => void supabase?.auth.signOut()

type RestaurantState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'ready'; restaurant: Restaurant }

function RestaurantGate({ userId, email }: { userId: string; email: string }) {
  const [state, setState] = useState<RestaurantState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let active = true
    fetchMyRestaurant(userId).then(
      (restaurant) => {
        if (active) setState(restaurant ? { status: 'ready', restaurant } : { status: 'none' })
      },
      (e) => {
        if (active) setState({ status: 'error', message: toRemoteError(e).message })
      },
    )
    return () => {
      active = false
    }
  }, [userId, attempt])

  if (state.status === 'loading') return <div className="auth">Loading…</div>
  if (state.status === 'none') return <RestaurantSetup email={email} onCreated={retry} onSignOut={signOut} />
  if (state.status === 'error') {
    return (
      <div className="auth">
        <div className="auth__card">
          <h1>Can't open the restaurant</h1>
          <p className="auth__error">{state.message}</p>
          <button className="btn btn--primary btn--large" onClick={retry}>
            Try again
          </button>
          <button className="btn btn--ghost" onClick={signOut}>
            Log out
          </button>
        </div>
      </div>
    )
  }
  return <RestaurantApp restaurant={state.restaurant} onSignOut={signOut} />
}

export default App // make it reusable elsewhere
