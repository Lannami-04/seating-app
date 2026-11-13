import { useEffect, useMemo, useReducer, useState } from 'react'
import type { Family, Reservation, RestaurantLayout } from '../types'
import type { TableStatus } from '../logic/seating'
import { assignableEmptyChairs, canReserveTable, chairOwners, tableStatuses } from '../logic/seating'
import { guestsSeated, toLiveLayout } from '../logic/liveLayout'
import { TABLE_KINDS } from '../logic/designTables'
import { chairsForParty, suggestTable } from '../logic/suggest'
import { eventReducer } from '../state/eventReducer'
import { loadEventState, saveEventState } from '../state/storage'
import { nowMs } from '../state/undoHistory'
import { colors } from '../theme'
import type { LiveTableLook } from './DesignTableShape'
import LiveFloor from './LiveFloor'
import SeatCounter from './SeatCounter'
import TableDetail from './TableDetail'
import ReservationBar from './ReservationBar'
import ConfirmDialog from './ConfirmDialog'
import PartySizeBar from './PartySizeBar'

interface LiveSeatingScreenProps {
  layout: RestaurantLayout
  onBack: () => void
  onEditLayout: () => void
  /** End of the event: clear seating, make every VIP / big group table a plain regular table, go to the menu. */
  onEndSeating: () => void
}

interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

/** Colors and middle text of one table during service. */
function liveLook(status: TableStatus, owners: Map<string, Family>, chairIds: string[]): LiveTableLook {
  const r = status.reservation
  if (r) {
    const seated = r.status === 'seated'
    const held = r.held ? TABLE_KINDS.vip : { fill: colors.chairReserved, stroke: '#B59A4A', text: colors.ink }
    return {
      fill: seated ? colors.tableFull : held.fill,
      stroke: seated ? colors.tableFullStroke : held.stroke,
      textColor: seated ? colors.white : held.text,
      dashed: !seated,
      centerText: r.name,
      chairFill: () => (seated ? colors.tableFull : colors.chairReserved),
    }
  }
  return {
    fill: status.isFull ? colors.tableFull : colors.tableFree,
    stroke: status.isFull ? colors.tableFullStroke : colors.tableFreeStroke,
    textColor: status.isFull ? colors.white : colors.ink,
    dashed: false,
    centerText: status.isFull ? '' : String(status.remaining),
    chairFill: (i) => owners.get(chairIds[i])?.color ?? colors.chairFree,
  }
}

/**
 * The hostess's screen for one restaurant: live table colors, open-seat counts,
 * and tapping a table to seat guests chair by chair.
 */
function LiveSeatingScreen({ layout, onBack, onEditLayout, onEndSeating }: LiveSeatingScreenProps) {
  const [event, dispatch] = useReducer(eventReducer, layout.id, loadEventState)
  const [openTableId, setOpenTableId] = useState<string | null>(null)
  // null = not making a reservation; otherwise the tables picked so far.
  const [reserving, setReserving] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  // "Seated 8 at T5 · Undo" message after filling a table with a double tap.
  const [filled, setFilled] = useState<{ familyId: string; text: string; at: number } | null>(null)
  useEffect(() => {
    if (!filled) return
    const timer = window.setTimeout(() => setFilled(null), 6000)
    return () => window.clearTimeout(timer)
  }, [filled])
  // Party size tapped in the bottom bar (null = none): the best table for it glows.
  const [partySize, setPartySize] = useState<number | null>(null)

  const live = useMemo(() => toLiveLayout(layout), [layout])
  const tablesById = useMemo(() => new Map(live.tables.map((t) => [t.id, t])), [live])
  const tableNames = (ids: string[]) => ids.map((id) => tablesById.get(id)?.name ?? id)

  // Tidy up after layout edits and hold VIP / group tables (also on first open).
  useEffect(() => dispatch({ type: 'syncLayout', layout, now: nowMs() }), [layout])
  // Save after every change so a refresh on the tablet keeps the seating.
  useEffect(() => saveEventState(layout.id, event), [layout.id, event])

  // Escape closes the top-most layer (handy on desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirm) setConfirm(null)
      else if (openTableId) setOpenTableId(null)
      else if (reserving) setReserving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, openTableId, reserving])

  // Everything below is worked out from `event` + layout each time; nothing is stored twice.
  const statuses = useMemo(() => tableStatuses(live, event.families, event.reservations), [live, event])
  const owners = useMemo(() => chairOwners(event.families), [event.families])
  const looks = useMemo(() => {
    const map = new Map<string, LiveTableLook>()
    const designed = new Map(layout.tables.map((t) => [t.id, t]))
    for (const t of live.tables) {
      const status = statuses.get(t.id)
      if (!status) continue
      const look = liveLook(status, owners, t.chairs.map((c) => c.id))
      // A held big group with no name: show its seat count (like the editor does), not "Big group T5".
      const dt = designed.get(t.id)
      if (status.reservation?.held && status.reservation.status !== 'seated' && dt?.kind === 'group' && !dt.guestName.trim()) {
        look.centerText = String(dt.seats)
      }
      map.set(t.id, look)
    }
    return map
  }, [live, layout, statuses, owners])
  const reservableIds = useMemo(
    () => new Set(live.tables.filter((t) => canReserveTable(t.id, event.families, event.reservations)).map((t) => t.id)),
    [live, event],
  )
  const open = assignableEmptyChairs(live, event.families, event.reservations)
  const seated = guestsSeated(event)
  const sectionName = (tableId: string) => {
    const id = layout.tables.find((t) => t.id === tableId)?.sectionId
    return layout.sections.find((s) => s.id === id)?.name ?? ''
  }

  const suggestion = partySize ? suggestTable(layout, statuses, partySize) : null
  const suggestionNote =
    partySize === null
      ? ''
      : suggestion
        ? `→ ${tablesById.get(suggestion.tableId)?.name ?? ''} · ${suggestion.reason}`
        : `No single table has ${partySize} open seats`

  function handleTableTap(tableId: string) {
    if (reserving) {
      if (!reservableIds.has(tableId)) return
      setReserving(reserving.includes(tableId) ? reserving.filter((id) => id !== tableId) : [...reserving, tableId])
      return
    }
    setOpenTableId(tableId)
  }

  /** Double tap: one party takes all the table's open seats (not on held / reserved tables). */
  function fillTable(tableId: string) {
    if (reserving) return
    const table = tablesById.get(tableId)
    const status = statuses.get(tableId)
    if (!table || !status || status.reservation) return
    const chairIds = table.chairs.filter((c) => c.kind !== 'highchair' && !owners.has(c.id)).map((c) => c.id)
    if (chairIds.length === 0) return
    const familyId = `F${event.nextFamilyNumber}`
    dispatch({ type: 'createFamily', tableId, chairIds, now: nowMs() })
    setPartySize(null)
    setFilled({ familyId, text: `Seated ${chairIds.length} at ${table.name}`, at: nowMs() })
  }

  function saveReservation(name: string, partySize: number) {
    if (!reserving) return
    dispatch({ type: 'createReservation', name, partySize, tableIds: reserving, now: nowMs() })
    setReserving(null)
  }

  function confirmSeat(r: Reservation) {
    setConfirm({
      title: `Seat ${r.name}?`,
      message: `Mark the party of ${r.partySize} as seated. ${tableNames(r.tableIds).join(', ')} will turn green.`,
      confirmLabel: 'Seat party',
      onConfirm: () => {
        dispatch({ type: 'seatReservation', reservationId: r.id })
        setOpenTableId(null)
      },
    })
  }

  function confirmRelease(r: Reservation) {
    setConfirm({
      title: r.held ? `Release ${tableNames(r.tableIds).join(', ')}?` : `Cancel ${r.name}?`,
      message: r.held
        ? `The hold for ${r.name} is removed and walk-ins can sit there. It won't be held again until you clear all seating.`
        : `${tableNames(r.tableIds).join(', ')} will be open for walk-ins again.`,
      confirmLabel: r.held ? 'Release table' : 'Cancel reservation',
      danger: true,
      onConfirm: () => dispatch({ type: 'cancelReservation', reservationId: r.id }),
    })
  }

  function confirmClearTable(tableId: string) {
    const status = statuses.get(tableId)
    if (!status) return
    const parts: string[] = []
    if (status.families.length > 0) {
      const n = status.families.length
      parts.push(`${n} ${n === 1 ? 'family' : 'families'} will be marked done and their chairs freed.`)
    }
    const r = status.reservation
    if (r) {
      parts.push(
        r.status === 'seated'
          ? `${r.name}'s party will be marked done, freeing ${tableNames(r.tableIds).join(', ')}.`
          : `${r.name}'s ${r.held ? 'hold' : 'reservation'} will be removed.`,
      )
    }
    setConfirm({
      title: `Clear table ${tablesById.get(tableId)?.name ?? ''}?`,
      message: parts.join(' '),
      confirmLabel: 'Clear table',
      danger: true,
      onConfirm: () => dispatch({ type: 'clearTable', tableId }),
    })
  }

  function confirmEndSeating() {
    const special = layout.tables.filter((t) => t.kind !== 'regular').length
    setConfirm({
      title: 'End live seating?',
      message:
        `All guests, reservations and holds are cleared` +
        (special > 0
          ? `, and all ${special} VIP / big group ${special === 1 ? 'table becomes a regular table' : 'tables become regular tables'} with their names removed`
          : '') +
        `. Seat counts, wheelchair-accessible seats, highchairs and sections stay the same. This can't be undone. You'll go back to the menu.`,
      confirmLabel: 'End live seating',
      danger: true,
      onConfirm: onEndSeating,
    })
  }

  function confirmClearAll() {
    setConfirm({
      title: 'Clear all seating?',
      message: 'Every guest and reservation is cleared, and VIP / Big group tables are held again. Use this at the end of the night.',
      confirmLabel: 'Clear all seating',
      danger: true,
      onConfirm: () => {
        dispatch({ type: 'resetEvent' })
        dispatch({ type: 'syncLayout', layout, now: nowMs() })
        setOpenTableId(null)
        setReserving(null)
      },
    })
  }

  function goEdit() {
    if (seated === 0) {
      onEditLayout()
      return
    }
    setConfirm({
      title: 'Edit the layout during service?',
      message: `${seated} guests are seated right now. Their seating is kept, but if you delete tables or remove chairs, guests on them are cleared.`,
      confirmLabel: 'Edit layout',
      onConfirm: onEditLayout,
    })
  }

  const openTable = openTableId ? tablesById.get(openTableId) : undefined
  const openStatus = openTableId ? statuses.get(openTableId) : undefined
  const reservingTables = (reserving ?? []).flatMap((id) => tablesById.get(id) ?? [])

  return (
    <div className="app">
      <header className="topbar live__bar">
        <div className="live__title">
          <button className="btn btn--ghost btn--icon" onClick={onBack} aria-label="Back to my restaurants">
            ‹
          </button>
          <div>
            <p className="live__name">{layout.name} · live seating</p>
            <SeatCounter open={open} seated={seated} />
          </div>
        </div>
        <div className="topbar__actions">
          {reserving ? (
            <ReservationBar
              tableNames={reservingTables.map((t) => t.name)}
              seatTotal={reservingTables.reduce((sum, t) => sum + t.chairs.filter((c) => c.kind !== 'highchair').length, 0)}
              onSave={saveReservation}
              onCancel={() => setReserving(null)}
            />
          ) : (
            <>
              <button className="btn btn--primary" onClick={() => setReserving([])}>
                Reserve tables
              </button>
              <button className="btn" onClick={goEdit}>
                Edit layout
              </button>
              <button className="btn btn--quiet-danger" onClick={confirmClearAll}>
                Clear all seating
              </button>
              <button className="btn btn--danger" onClick={confirmEndSeating}>
                End live seating
              </button>
            </>
          )}
        </div>
      </header>

      {/* Its own strip under the top bar, so it never covers anything on the floor. */}
      {layout.tables.length > 0 && (
        <div className="live__strip">
          {!reserving && <PartySizeBar size={partySize} onPick={setPartySize} note={suggestionNote} />}
        </div>
      )}

      <main className="app__main">
        {layout.tables.length === 0 ? (
          <div className="live__empty">
            <p>This restaurant has no tables yet.</p>
            <button className="btn btn--primary btn--large" onClick={onEditLayout}>
              Design the layout
            </button>
          </div>
        ) : (
          <LiveFloor
            layout={layout}
            looks={looks}
            selectedTableIds={new Set(reserving ?? [])}
            selectableTableIds={reserving ? reservableIds : null}
            onTableTap={handleTableTap}
            onTableDoubleTap={fillTable}
            suggestedTableId={reserving ? null : (suggestion?.tableId ?? null)}
          />
        )}
      </main>

      {openTable && openStatus && (
        <TableDetail
          key={openTable.id}
          table={openTable}
          // With a party size picked, that many empty chairs (side by side) start selected: just press Done.
          initialSelected={
            partySize && !openStatus.reservation && openStatus.remaining >= partySize
              ? chairsForParty(openTable, owners, partySize)
              : undefined
          }
          sectionName={sectionName(openTable.id)}
          status={openStatus}
          owners={owners}
          reservationTableNames={tableNames(openStatus.reservation?.tableIds ?? [])}
          onClose={() => setOpenTableId(null)}
          onCreateFamily={(chairIds) => {
            dispatch({ type: 'createFamily', tableId: openTable.id, chairIds, now: nowMs() })
            setOpenTableId(null)
            setPartySize(null) // party seated: suggestion done
          }}
          onUpdateFamily={(familyId, chairIds) => dispatch({ type: 'updateFamilyChairs', familyId, chairIds })}
          onFamilyDone={(familyId) => dispatch({ type: 'markFamilyDone', familyId })}
          onRemoveFamily={(familyId) =>
            setConfirm({
              title: `Remove family ${familyId}?`,
              message: 'Use this only if the family was entered by mistake. Their chairs are freed.',
              confirmLabel: 'Remove',
              danger: true,
              onConfirm: () => dispatch({ type: 'removeFamily', familyId }),
            })
          }
          onSeatReservation={confirmSeat}
          onCancelReservation={confirmRelease}
          onClearTable={() => confirmClearTable(openTable.id)}
        />
      )}

      {filled && (
        <div className="toast" role="status" key={filled.at}>
          <span>{filled.text}</span>
          <button
            className="btn toast__undo"
            onClick={() => {
              dispatch({ type: 'removeFamily', familyId: filled.familyId })
              setFilled(null)
            }}
          >
            Undo
          </button>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.onConfirm()
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

export default LiveSeatingScreen
