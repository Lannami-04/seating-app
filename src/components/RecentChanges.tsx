import type { EventChange } from '../state/remote'
import { DEVICE_ID } from '../lib/device'
import { clockTime } from '../logic/clock'

interface RecentChangesProps {
  changes: EventChange[]
  /** Changes newer than this id (from another device) are marked new. */
  seenUpTo: number
  /** Open the table a change was about. */
  onOpenTable: (tableId: string) => void
  onClose: () => void
}

/** Small drop-down list: "7:42 PM · Family F12 moved P1 → P3 · other device". Newest first. */
function RecentChanges({ changes, seenUpTo, onOpenTable, onClose }: RecentChangesProps) {
  return (
    <div className="recent" role="dialog" aria-label="Recent changes">
      <div className="recent__head">
        <h3>Recent changes</h3>
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {changes.length === 0 ? (
        <p className="recent__empty">Nothing changed yet. Seating changes from every device show up here.</p>
      ) : (
        <ul className="recent__list">
          {changes.map((c) => {
            const elsewhere = c.deviceId !== DEVICE_ID
            const isNew = elsewhere && c.id > seenUpTo
            const tableId = c.tableIds[c.tableIds.length - 1]
            return (
              <li key={c.id}>
                <button
                  className={`recent__item${isNew ? ' recent__item--new' : ''}`}
                  onClick={() => tableId && onOpenTable(tableId)}
                  disabled={!tableId}
                >
                  <span className="recent__time">{clockTime(c.at)}</span>
                  <span className="recent__message">{c.message}</span>
                  <span className="recent__who">{elsewhere ? 'other device' : 'this tablet'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default RecentChanges
