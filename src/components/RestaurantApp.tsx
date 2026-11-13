import { useEffect, useMemo, useState } from 'react'
import type { RestaurantLayout } from '../types'
import type { Restaurant } from '../state/remote'
import { endEvent, fetchEventState, toRemoteError } from '../state/remote'
import { useRestaurantLayouts } from '../state/useRestaurantLayouts'
import {
  createLayout,
  loadLocalLayouts,
  markLocalLayoutsUploaded,
  withAllTablesRegular,
  withDatabaseId,
  withDistinctSectionColors,
} from '../state/layoutStorage'
import { occupiedTableIds } from '../logic/liveLayout'
import { sampleLuauLayout } from '../data/sampleLuauLayout'
import HomeScreen from './HomeScreen'
import LayoutEditor from './LayoutEditor'
import LiveSeatingScreen from './LiveSeatingScreen'
import ConnectionBanner from './ConnectionBanner'

/** Which screen is showing: the home menu, designing a layout, or seating guests on it. */
type Screen = { kind: 'home' } | { kind: 'edit'; id: string; occupied: Set<string> } | { kind: 'live'; id: string }

interface RestaurantAppProps {
  restaurant: Restaurant
  onSignOut: () => void
}

/**
 * Everything for one restaurant once staff are logged in. Owns the list of layouts (kept in step
 * with the database by useRestaurantLayouts) and decides which screen is showing:
 *   home menu  →  Edit layout (design the floor)  ⇄  Seat guests (live seating for the hostess)
 */
function RestaurantApp({ restaurant, onSignOut }: RestaurantAppProps) {
  const data = useRestaurantLayouts(restaurant.id)
  // Every section always shows in a color that looks different from the other sections.
  const layouts = useMemo(() => data.layouts.map(withDistinctSectionColors), [data.layouts])
  const [screen, setScreen] = useState<Screen>({ kind: 'home' })
  // Short message at the bottom, e.g. when something couldn't be saved.
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 6000)
    return () => window.clearTimeout(timer)
  }, [message])
  // Layouts this browser kept before the app used the database (offered once for copying).
  const [localLayouts, setLocalLayouts] = useState(loadLocalLayouts)

  const current = screen.kind === 'home' ? undefined : layouts.find((l) => l.id === screen.id)

  /** Opens the editor. Tables with guests right now get a warning before they can be deleted. */
  async function openEditor(id: string, occupied?: Set<string>) {
    let ids = occupied
    if (!ids) {
      const live = data.liveEvents.get(id)
      ids = new Set<string>()
      if (live) {
        try {
          ids = occupiedTableIds(await fetchEventState(live.eventId))
        } catch {
          // Offline: open anyway; the editor just can't warn about seated tables.
        }
      }
    }
    setScreen({ kind: 'edit', id, occupied: ids })
  }

  /** Live seating needs the newest layout in the database first (guests sit on its chairs). */
  async function openSeating(id: string) {
    if (await data.saveNow(id)) setScreen({ kind: 'live', id })
    else setMessage("Couldn't save the layout, so seating can't open yet. Check the connection and try again.")
  }

  async function endSeating(layout: RestaurantLayout, eventId: string | null) {
    try {
      if (eventId) await endEvent(eventId)
      // End of the event: plain regular tables, no seating left, back to the menu.
      data.updateLayout(withAllTablesRegular(layout))
      await data.saveNow(layout.id)
      setScreen({ kind: 'home' })
    } catch (e) {
      setMessage(toRemoteError(e).message)
    }
  }

  /** Saves layouts from a file, the sample or this browser into the database. Returns how many were saved. */
  async function addLayouts(list: RestaurantLayout[]): Promise<number> {
    let saved = 0
    for (const layout of list) {
      await data.addLayout(withDatabaseId(layout))
      saved += 1
    }
    return saved
  }

  let body
  if (current && screen.kind === 'edit') {
    body = (
      <LayoutEditor
        key={current.id}
        layout={current}
        occupiedTableIds={screen.occupied}
        onChange={data.updateLayout}
        onBack={() => {
          void data.saveNow(current.id)
          setScreen({ kind: 'home' })
        }}
        onStartSeating={() => void openSeating(current.id)}
      />
    )
  } else if (current && screen.kind === 'live') {
    body = (
      <LiveSeatingScreen
        key={current.id}
        layout={current}
        onBack={() => setScreen({ kind: 'home' })}
        onEditLayout={(occupied) => void openEditor(current.id, occupied)}
        onEndSeating={(eventId) => endSeating(current, eventId)}
        onEndedElsewhere={() => {
          setMessage('Live seating was ended on another tablet.')
          setScreen({ kind: 'home' })
        }}
      />
    )
  } else {
    body = (
      <HomeScreen
        restaurantName={restaurant.name}
        layouts={layouts}
        loading={data.loading}
        loadError={data.loadError}
        seatedByLayout={new Map([...data.liveEvents].map(([id, e]) => [id, e.guestsSeated]))}
        localLayoutCount={localLayouts.length}
        onCreate={async (name) => {
          const layout = createLayout(name)
          try {
            await data.addLayout(layout)
            setScreen({ kind: 'edit', id: layout.id, occupied: new Set() }) // straight to the blank canvas
          } catch (e) {
            setMessage(toRemoteError(e).message)
          }
        }}
        onEdit={(id) => void openEditor(id)}
        onSeat={(id) => void openSeating(id)}
        onImport={addLayouts}
        onLoadSample={() => addLayouts([sampleLuauLayout()])}
        onCopyLocal={async () => {
          const saved = await addLayouts(localLayouts)
          markLocalLayoutsUploaded()
          setLocalLayouts([])
          return saved
        }}
        onDelete={async (id) => {
          try {
            await data.removeLayout(id)
          } catch (e) {
            setMessage(toRemoteError(e).message)
          }
        }}
        onSignOut={onSignOut}
      />
    )
  }

  return (
    <div className="shell">
      {/* A strip above the screen (never covering its buttons) while offline. */}
      <ConnectionBanner saveStatus={data.saveStatus} />
      <div className="shell__screen">{body}</div>
      {message && (
        <div className="toast toast--error" role="alert">
          <span>{message}</span>
          <button className="btn toast__undo" onClick={() => setMessage('')}>
            OK
          </button>
        </div>
      )}
    </div>
  )
}

export default RestaurantApp
