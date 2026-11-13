// Is this tablet connected to the backend right now?
// "Online" means: the browser has a network AND every real-time subscription is connected.
// Supabase reconnects subscriptions by itself; this file only keeps track so the app can show
// the "Offline / reconnecting" banner and refuse seating changes while it can't reach the database.

import { useSyncExternalStore } from 'react'

/** Status of each real-time subscription, by a name chosen by whoever subscribed. */
const channels = new Map<string, boolean>()
const listeners = new Set<() => void>()
let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine
let snapshot = computeOnline()

function computeOnline(): boolean {
  return browserOnline && [...channels.values()].every(Boolean)
}

function notify() {
  const next = computeOnline()
  if (next === snapshot) return
  snapshot = next
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    browserOnline = true
    notify()
  })
  window.addEventListener('offline', () => {
    browserOnline = false
    notify()
  })
}

/** Called from a subscription's status callback: connected (true) or not (false). */
export function reportChannel(name: string, connected: boolean): void {
  channels.set(name, connected)
  notify()
}

/** Called when a subscription is closed on purpose (leaving a screen), so it no longer counts. */
export function forgetChannel(name: string): void {
  channels.delete(name)
  notify()
}

export function isOnline(): boolean {
  return snapshot
}

/** React hook: re-renders the component whenever the tablet goes offline or comes back. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
  )
}
