import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type { RestaurantLayout } from './types'
import { createLayout, loadLayouts, saveLayouts, withAllTablesRegular, withDistinctSectionColors } from './state/layoutStorage'
import { deleteEventState, loadEventState } from './state/storage'
import { occupiedTableIds } from './logic/liveLayout'
import HomeScreen from './components/HomeScreen'
import LayoutEditor from './components/LayoutEditor'
import LiveSeatingScreen from './components/LiveSeatingScreen'

/** Which screen is showing: the home menu, designing a layout, or seating guests on it. */
type Screen = { kind: 'home' } | { kind: 'edit'; id: string } | { kind: 'live'; id: string }

/**
 * The top of the app. Owns the list of restaurant layouts and decides which screen is showing:
 *   home menu  →  Edit layout (design the floor)  ⇄  Seat guests (live seating for the hostess)
 */
function App() {
  // Loaded once from the browser; saved again after every change.
  const [stored, setLayouts] = useState<RestaurantLayout[]>(loadLayouts)
  // Every section always shows in a color that looks different from the other sections.
  const layouts = useMemo(() => stored.map(withDistinctSectionColors), [stored])
  const [screen, setScreen] = useState<Screen>({ kind: 'home' })

  useEffect(() => saveLayouts(layouts), [layouts])

  const current = screen.kind === 'home' ? undefined : layouts.find((l) => l.id === screen.id)

  if (current && screen.kind === 'edit') {
    return (
      <LayoutEditor
        key={current.id}
        layout={current}
        // Tables with guests right now (read once when the editor opens; seating can't change while editing).
        occupiedTableIds={occupiedTableIds(loadEventState(current.id))}
        onChange={(updated) => setLayouts((all) => all.map((l) => (l.id === updated.id ? updated : l)))}
        onBack={() => setScreen({ kind: 'home' })}
        onStartSeating={() => setScreen({ kind: 'live', id: current.id })}
      />
    )
  }

  if (current && screen.kind === 'live') {
    return (
      <LiveSeatingScreen
        key={current.id}
        layout={current}
        onBack={() => setScreen({ kind: 'home' })}
        onEditLayout={() => setScreen({ kind: 'edit', id: current.id })}
        onEndSeating={() => {
          // End of the event: plain regular tables, no seating left, back to the menu.
          setLayouts((all) => all.map((l) => (l.id === current.id ? withAllTablesRegular(l) : l)))
          deleteEventState(current.id)
          setScreen({ kind: 'home' })
        }}
      />
    )
  }

  return (
    <HomeScreen
      layouts={layouts}
      onCreate={(name) => {
        const layout = createLayout(name)
        setLayouts((all) => [...all, layout])
        setScreen({ kind: 'edit', id: layout.id }) // go straight to the blank canvas
      }}
      onEdit={(id) => setScreen({ kind: 'edit', id })}
      onSeat={(id) => setScreen({ kind: 'live', id })}
      onImport={(imported) =>
        setLayouts((all) => {
          const ids = new Set(imported.map((l) => l.id))
          return [...all.filter((l) => !ids.has(l.id)), ...imported]
        })
      }
      onDelete={(id) => {
        setLayouts((all) => all.filter((l) => l.id !== id))
        deleteEventState(id)
      }}
    />
  )
}

export default App // make it reusable elsewhere
