// React hook that keeps a restaurant's layouts in step with the database.
//
// Layout editing stays quick: each change shows at once on this tablet and is saved to the
// database shortly after (saves are grouped, so dragging a table doesn't send hundreds of saves).
// Other tablets reload the layouts when the database tells them something changed.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RestaurantLayout } from '../types'
import { supabase } from '../lib/supabase'
import { forgetChannel, reportChannel, useOnline } from './connection'
import { deleteLayout, fetchLayouts, fetchLiveEvents, saveLayout, toRemoteError, type LiveEvents } from './remote'

/** How long to wait after the last edit before saving (ms). */
const SAVE_DELAY = 700
/** How long to wait before trying a failed save again (ms). */
const RETRY_DELAY = 5000

export type SaveStatus = 'saved' | 'saving' | 'failed'

export interface RestaurantLayouts {
  layouts: RestaurantLayout[]
  /** Layouts with live seating right now, and how many guests sit there. */
  liveEvents: LiveEvents
  loading: boolean
  loadError: string
  saveStatus: SaveStatus
  /** Show a change at once and save it soon. */
  updateLayout: (layout: RestaurantLayout) => void
  /** Save any waiting change to this layout right away. Resolves false if it couldn't be saved. */
  saveNow: (layoutId: string) => Promise<boolean>
  /** Save a new or replaced layout right away (create, import, sample). Throws a RemoteError on failure. */
  addLayout: (layout: RestaurantLayout) => Promise<void>
  removeLayout: (layoutId: string) => Promise<void>
  reload: () => Promise<void>
}

export function useRestaurantLayouts(restaurantId: string): RestaurantLayouts {
  const online = useOnline()
  const [layouts, setLayouts] = useState<RestaurantLayout[]>([])
  const [liveEvents, setLiveEvents] = useState<LiveEvents>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  // Goes up each time a failed save should be tried again.
  const [retries, setRetries] = useState(0)
  // Edited here but not saved yet: these win over what the database sends back.
  const pending = useRef(new Map<string, RestaurantLayout>())
  const timers = useRef(new Map<string, number>())

  const reload = useCallback(async () => {
    try {
      const [fromDb, live] = await Promise.all([fetchLayouts(restaurantId), fetchLiveEvents(restaurantId)])
      setLayouts(fromDb.map((l) => pending.current.get(l.id) ?? l))
      setLiveEvents(live)
      setLoadError('')
    } catch (e) {
      setLoadError(toRemoteError(e).message)
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  // Real-time: the database bumps restaurants.version when layouts or live events change.
  useEffect(() => {
    const client = supabase
    if (!client) return
    const name = `restaurant:${restaurantId}`
    let active = true
    const channel = client
      .channel(name)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` }, () => {
        void reload()
      })
      .subscribe((status) => {
        if (!active) return
        reportChannel(name, status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') void reload() // first load, and catching up after reconnecting
      })
    return () => {
      active = false
      forgetChannel(name)
      void client.removeChannel(channel)
    }
  }, [restaurantId, reload])

  const flush = useCallback(
    async (layoutId: string): Promise<boolean> => {
      window.clearTimeout(timers.current.get(layoutId))
      timers.current.delete(layoutId)
      const layout = pending.current.get(layoutId)
      if (!layout) return true
      setSaveStatus('saving')
      try {
        await saveLayout(restaurantId, layout)
        // Only forget it if nothing newer was edited while this save was on its way.
        if (pending.current.get(layoutId) === layout) pending.current.delete(layoutId)
        setSaveStatus(pending.current.size > 0 ? 'saving' : 'saved')
        return true
      } catch {
        setSaveStatus('failed')
        // Keep trying; the edit stays on this tablet until it is saved.
        timers.current.set(
          layoutId,
          window.setTimeout(() => setRetries((n) => n + 1), RETRY_DELAY),
        )
        return false
      }
    },
    [restaurantId],
  )

  // Back online, or time to retry: save whatever couldn't be saved yet.
  useEffect(() => {
    if (!online) return
    for (const id of [...pending.current.keys()]) void flush(id)
  }, [online, flush, retries])

  const updateLayout = useCallback(
    (layout: RestaurantLayout) => {
      pending.current.set(layout.id, layout)
      setLayouts((all) => all.map((l) => (l.id === layout.id ? layout : l)))
      setSaveStatus('saving')
      window.clearTimeout(timers.current.get(layout.id))
      timers.current.set(
        layout.id,
        window.setTimeout(() => void flush(layout.id), SAVE_DELAY),
      )
    },
    [flush],
  )

  const addLayout = useCallback(
    async (layout: RestaurantLayout) => {
      await saveLayout(restaurantId, layout)
      setLayouts((all) => [...all.filter((l) => l.id !== layout.id), layout])
    },
    [restaurantId],
  )

  const removeLayout = useCallback(async (layoutId: string) => {
    window.clearTimeout(timers.current.get(layoutId))
    pending.current.delete(layoutId)
    await deleteLayout(layoutId)
    setLayouts((all) => all.filter((l) => l.id !== layoutId))
  }, [])

  return { layouts, liveEvents, loading, loadError, saveStatus, updateLayout, saveNow: flush, addLayout, removeLayout, reload }
}
