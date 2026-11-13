// React hook that connects the live seating screen to the shared event in the database.
//
//   1. joins (or starts) the layout's live event,
//   2. loads the seating, and reloads it whenever the database says it changed (real-time),
//   3. sends each change to the database and only shows it once the database accepted it.
//
// Nothing is changed on screen "optimistically": if two tablets tap the same chair, the database
// accepts the first and refuses the second, and the second tablet shows "Chair just taken".

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventState, RestaurantLayout } from '../types'
import { supabase } from '../lib/supabase'
import { forgetChannel, isOnline, reportChannel, useOnline } from './connection'
import {
  fetchEventState,
  runLiveAction,
  startEvent,
  syncHolds,
  toRemoteError,
  type EventChange,
  type LiveAction,
  type RemoteEventState,
} from './remote'

const NO_CHANGES: EventChange[] = []
const NO_CHECKS = new Map<string, number>()
const EMPTY: EventState = { families: [], reservations: [], nextFamilyNumber: 1, nextReservationNumber: 1, heldTableIds: [] }

export type RunResult = { ok: true; id: string | null } | { ok: false; code: string; message: string }

export interface LiveEvent {
  eventId: string | null
  /** The seating as last confirmed by the database (empty while loading). */
  event: EventState
  /** Newest changes first ("Recent changes"). */
  changes: EventChange[]
  /** Table id → when it was last checked against the floor (ms). */
  checks: Map<string, number>
  /** False until the first load finished. */
  ready: boolean
  /** True once anyone ended this live seating. */
  ended: boolean
  /** A change is being saved right now. */
  busy: boolean
  /** Why the seating couldn't be opened (shown instead of the floor), or ''. */
  loadError: string
  run: (action: LiveAction) => Promise<RunResult>
}

export function useLiveEvent(layout: RestaurantLayout): LiveEvent {
  const online = useOnline()
  const [eventId, setEventId] = useState<string | null>(null)
  const [remote, setRemote] = useState<RemoteEventState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  // Newest version applied so far: a slow, older reply never overwrites a newer one.
  const versionRef = useRef(-1)

  // 1. Join or start the live event (tried again when the connection comes back).
  useEffect(() => {
    if (eventId || !online) return
    let cancelled = false
    startEvent(layout.id).then(
      (id) => {
        if (!cancelled) setEventId(id)
      },
      (e) => {
        if (!cancelled) setLoadError(toRemoteError(e).message)
      },
    )
    return () => {
      cancelled = true
    }
  }, [layout.id, eventId, online])

  const refresh = useCallback(async () => {
    if (!eventId) return
    try {
      const next = await fetchEventState(eventId)
      if (next.version < versionRef.current) return
      versionRef.current = next.version
      setRemote(next)
      setLoadError('')
    } catch {
      // Offline: the banner is showing, and we reload as soon as the subscription reconnects.
    }
  }, [eventId])

  // 2. Real-time: the database bumps events.version on every change; reload when it does.
  useEffect(() => {
    const client = supabase
    if (!eventId || !client) return
    const name = `event:${eventId}`
    let active = true
    const channel = client
      .channel(name)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, () => {
        void refresh()
      })
      .subscribe((status) => {
        if (!active) return
        reportChannel(name, status === 'SUBSCRIBED')
        // First load, and catching up on anything missed while the connection was down.
        if (status === 'SUBSCRIBED') void refresh()
      })
    return () => {
      active = false
      forgetChannel(name)
      void client.removeChannel(channel)
    }
  }, [eventId, refresh])

  // Hold VIP / big-group tables when seating opens and after the layout changes.
  useEffect(() => {
    if (!eventId) return
    syncHolds(eventId, layout).catch(() => {
      // Tried again on the next layout change or when seating is reopened.
    })
  }, [eventId, layout])

  // 3. Send one change. The screen updates from the database's answer, never before.
  const run = useCallback(
    async (action: LiveAction): Promise<RunResult> => {
      if (!eventId || !remote) return { ok: false, code: 'loading', message: 'The seating is still loading.' }
      if (!isOnline()) {
        return { ok: false, code: 'offline', message: "You're offline, so this wasn't saved. Try again when the connection is back." }
      }
      setBusy(true)
      try {
        const id = await runLiveAction(eventId, action, remote)
        await refresh()
        return { ok: true, id }
      } catch (e) {
        const error = toRemoteError(e)
        await refresh() // show what the database has now (e.g. who took the chair)
        return { ok: false, code: error.code, message: error.message }
      } finally {
        setBusy(false)
      }
    },
    [eventId, remote, refresh],
  )

  return {
    eventId,
    event: remote ?? EMPTY,
    changes: remote?.changes ?? NO_CHANGES,
    checks: remote?.checks ?? NO_CHECKS,
    ready: remote !== null,
    ended: remote?.ended ?? false,
    busy,
    loadError,
    run,
  }
}
