// The one shared connection to the Supabase backend (database, login and real-time updates).
// Every other file imports `supabase` from here instead of creating its own client.
//
// The URL and key come from .env.local (never committed). Vite only exposes variables that
// start with VITE_ to the browser. The publishable key is safe to ship in the app: what each
// user may read or change is decided by Row Level Security rules in the database.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DEVICE_ID } from './device'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Null when .env.local is missing the settings; the app then shows a setup message instead of crashing. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 20 } },
        // Lets the database note which device made each change (see "Recent changes").
        global: { headers: { 'x-device-id': DEVICE_ID } },
      })
    : null
