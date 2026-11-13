import { useOnline } from '../state/connection'
import type { SaveStatus } from '../state/useRestaurantLayouts'

/**
 * A banner across the top whenever the tablet can't reach the database.
 * While it shows, seating changes are refused (they only count once the database accepts them).
 */
function ConnectionBanner({ saveStatus }: { saveStatus: SaveStatus }) {
  const online = useOnline()
  if (online && saveStatus !== 'failed') return null
  return (
    <div className={`connection-banner${online ? ' connection-banner--warn' : ''}`} role="status" aria-live="polite">
      {online ? (
        <>Couldn't save the layout yet. Trying again…</>
      ) : (
        <>
          <strong>Offline · reconnecting…</strong> Seating changes can't be saved until the connection is back.
        </>
      )}
    </div>
  )
}

export default ConnectionBanner
