// Who is logged in? Supabase Auth keeps the login in the browser, so a refresh or
// restarting the tablet doesn't log staff out.

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export function useSession(): { session: Session | null; loading: boolean } {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({ session: null, loading: true })

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    client.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false })
    })
    // Fires on log in, log out and when the login token is renewed in the background.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return state
}
