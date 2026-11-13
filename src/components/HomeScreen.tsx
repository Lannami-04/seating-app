import { useRef, useState } from 'react'
import type { RestaurantLayout } from '../types'
import { downloadLayoutsFile, parseLayoutsFile } from '../state/layoutStorage'
import { totalSeats } from '../logic/designTables'
import { guestsSeated } from '../logic/liveLayout'
import { loadEventState } from '../state/storage'
import { colors } from '../theme'
import DesignTableShape from './DesignTableShape'
import DesignFeatureShape from './DesignFeatureShape'
import SectionOutline from './SectionOutline'
import NewLayoutDialog from './NewLayoutDialog'
import ConfirmDialog from './ConfirmDialog'

interface HomeScreenProps {
  layouts: RestaurantLayout[]
  onCreate: (name: string) => void
  /** Open the layout designer. */
  onEdit: (layoutId: string) => void
  /** Open live seating (the hostess view). */
  onSeat: (layoutId: string) => void
  onDelete: (layoutId: string) => void
  /** Layouts read from a saved file: same ones are replaced, new ones added. */
  onImport: (layouts: RestaurantLayout[]) => void
}

/** The first screen: a menu of the user's restaurant layouts, plus a "+" card to make a new one. */
function HomeScreen({ layouts, onCreate, onEdit, onSeat, onDelete, onImport }: HomeScreenProps) {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RestaurantLayout | null>(null)
  const [fileMessage, setFileMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  async function importFile(file: File) {
    try {
      const imported = parseLayoutsFile(await file.text())
      onImport(imported)
      setFileMessage(`Opened ${imported.length} ${imported.length === 1 ? 'layout' : 'layouts'} from the file.`)
    } catch {
      setFileMessage("That file isn't a saved layouts file.")
    }
  }

  // Most recently edited first.
  const sorted = [...layouts].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="home">
      <header className="home__header">
        <h1>My restaurants</h1>
        <p className="home__subtitle">
          {layouts.length === 0 ? 'Tap + to design your first restaurant layout.' : 'Edit layout to design the floor · Seat guests when you open for service.'}
        </p>
        <div className="home__file">
          <button
            className="btn"
            disabled={layouts.length === 0}
            onClick={() => {
              downloadLayoutsFile(layouts)
              setFileMessage('Saved. Look for the file in your Downloads.')
            }}
          >
            Save layouts to file
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Open layouts file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = '' // let the same file be picked again
              if (file) void importFile(file)
            }}
          />
          {fileMessage && <span className="home__file-message">{fileMessage}</span>}
        </div>
      </header>

      <main className="home__grid">
        <button className="home-card home-card--new" onClick={() => setCreating(true)} aria-label="Create a new restaurant layout">
          <span className="home-card__plus" aria-hidden="true">+</span>
          <span>New layout</span>
        </button>

        {sorted.map((layout) => {
          const seatedNow = guestsSeated(loadEventState(layout.id))
          return (
          <div key={layout.id} className="home-card">
            <button className="home-card__open" onClick={() => onEdit(layout.id)} aria-label={`Edit ${layout.name}`}>
              <svg
                className="home-card__preview"
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <rect width={layout.width} height={layout.height} fill={colors.ground} />
                {layout.sections.map((s) => (
                  <SectionOutline key={s.id} section={s} tables={layout.tables.filter((t) => t.sectionId === s.id)} />
                ))}
                {layout.features.map((f) => (
                  <DesignFeatureShape key={f.id} feature={f} showLabel={false} />
                ))}
                {layout.tables.map((t) => (
                  <DesignTableShape key={t.id} table={t} showText={false} />
                ))}
              </svg>
              <span className="home-card__name">{layout.name}</span>
              <span className="home-card__meta">
                {layout.tables.length} {layout.tables.length === 1 ? 'table' : 'tables'} · {totalSeats(layout.tables)} seats
              </span>
              {seatedNow > 0 && <span className="home-card__live">● Seating live · {seatedNow} seated</span>}
            </button>
            <div className="home-card__actions">
              <button className="btn" onClick={() => onEdit(layout.id)}>
                Edit layout
              </button>
              <button className="btn btn--primary" onClick={() => onSeat(layout.id)} disabled={layout.tables.length === 0}>
                Seat guests ▶
              </button>
            </div>
            <button className="btn btn--quiet-danger home-card__delete" onClick={() => setDeleting(layout)} aria-label={`Delete ${layout.name}`}>
              Delete
            </button>
          </div>
          )
        })}
      </main>

      {creating && (
        <NewLayoutDialog
          onCancel={() => setCreating(false)}
          onCreate={(name) => {
            setCreating(false)
            onCreate(name)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message="This layout, all its tables and its live seating will be removed. This can't be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

export default HomeScreen
