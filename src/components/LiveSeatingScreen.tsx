import { useEffect, useMemo, useState } from 'react'
import type { Family, Reservation, RestaurantLayout } from '../types'
import type { TableStatus } from '../logic/seating'
import { assignableEmptyChairs, canReserveTable, chairOwners, tableStatuses } from '../logic/seating'
import { guestsSeated, occupiedTableIds, toLiveLayout } from '../logic/liveLayout'
import { TABLE_KINDS } from '../logic/designTables'
import { chairsForParty, suggestTable } from '../logic/suggest'
import { useLiveEvent } from '../state/useLiveEvent'
import type { LiveAction } from '../state/remote'
import { nowMs } from '../state/undoHistory'
import { colors } from '../theme'
import type { LiveTableLook } from './DesignTableShape'
import LiveFloor from './LiveFloor'
import FloorLegend from './FloorLegend'
import SeatCounter from './SeatCounter'
import TableDetail from './TableDetail'
import ReservationBar from './ReservationBar'
import ConfirmDialog from './ConfirmDialog'
import PartySizeBar from './PartySizeBar'
import RecentChanges from './RecentChanges'
import { DEVICE_ID } from '../lib/device'

interface LiveSeatingScreenProps {
  layout: RestaurantLayout
  onBack: () => void
  /** Open the editor; `occupied` = tables with guests right now (they get a warning before deleting). */
  onEditLayout: (occupied: Set<string>) => void
  /** End of the event: clear seating, make every VIP / big group table a plain regular table, go to the menu. */
  onEndSeating: (eventId: string | null) => Promise<void>
  /** Another tablet ended live seating while this one had it open. */
  onEndedElsewhere: () => void
}

interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

/** Colors and middle text of one table during service. */
function liveLook(status: TableStatus, owners: Map<string, Family>, chairIds: string[], seatTotal: number): LiveTableLook {
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
    halo: fullnessHalo(status, seatTotal),
  }
}

/**
 * Glow around a table by how full it is: gray = nobody yet, red = only 1–2 seats left,
 * yellow = some guests. Full tables need no glow (the table itself turns green).
 */
function fullnessHalo(status: TableStatus, seatTotal: number): string | undefined {
  if (status.isFull) return undefined
  if (status.remaining >= seatTotal) return colors.haloEmpty
  if (status.remaining <= 2) return colors.haloAlmost
  return colors.haloSome
}

/**
 * The hostess's screen for one restaurant: live table colors, open-seat counts,
 * and tapping a table to seat guests chair by chair.
 */
function LiveSeatingScreen({ layout, onBack, onEditLayout, onEndSeating, onEndedElsewhere }: LiveSeatingScreenProps) {
  // The shared seating from the database; every tablet on this layout sees the same one.
  const shared = useLiveEvent(layout)
  const event = shared.event
  // Message when the database refused a change, e.g. "Chair just taken on another tablet".
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])
  // Changes when a table must start over (chairs picked there were just taken elsewhere).
  const [detailVersion, setDetailVersion] = useState(0)

  // Someone else pressed "End live seating".
  const { ended } = shared
  useEffect(() => {
    if (ended) onEndedElsewhere()
  }, [ended, onEndedElsewhere])

  /**
   * Sends one change to the database. Resolves ok only once the database accepted it;
   * otherwise shows why and refreshes the open table so the hostess sees who took the chairs.
   */
  async function perform(action: LiveAction): Promise<{ ok: boolean; id: string | null }> {
    const result = await shared.run(action)
    if (result.ok) return { ok: true, id: result.id }
    setNotice({ text: result.message, at: nowMs() })
    setDetailVersion((v) => v + 1)
    return { ok: false, id: null }
  }
  const [openTableId, setOpenTableId] = useState<string | null>(null)
  // null = not making a reservation; otherwise the tables picked so far.
  const [reserving, setReserving] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  // "Seated 8 at T5 · Undo" after a double tap, or "Moved F7 P1 → P3" after a move.
  const [filled, setFilled] = useState<{ familyId?: string; unseatId?: string; text: string; at: number } | null>(null)
  // The family being moved to another table (the floor asks for the new table), or null.
  const [movingId, setMovingId] = useState<string | null>(null)
  // "Recent changes" list open, and the newest change already looked at (null = not loaded yet).
  const [showRecent, setShowRecent] = useState(false)
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null)
  useEffect(() => {
    if (!filled) return
    const timer = window.setTimeout(() => setFilled(null), 6000)
    return () => window.clearTimeout(timer)
  }, [filled])
  // Party size tapped in the bottom bar (null = none): the best table for it glows.
  const [partySize, setPartySize] = useState<number | null>(null)

  const live = useMemo(() => toLiveLayout(layout), [layout])
  const tablesById = useMemo(() => new Map(live.tables.map((t) => [t.id, t])), [live])
  // Names in floor order (P1, P2, P3…), whatever order the ids come in.
  const tableOrder = useMemo(() => new Map(live.tables.map((t, i) => [t.id, i])), [live])
  const tableNames = (ids: string[]) =>
    [...ids].sort((a, b) => (tableOrder.get(a) ?? 0) - (tableOrder.get(b) ?? 0)).map((id) => tablesById.get(id)?.name ?? id)


  // Escape closes the top-most layer (handy on desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirm) setConfirm(null)
      else if (openTableId) setOpenTableId(null)
      else if (reserving) setReserving(null)
      else if (movingId) setMovingId(null)
      else if (showRecent) setShowRecent(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, openTableId, reserving, movingId, showRecent])

  // Recent changes: what was already there when seating opened isn't "new"; while the list is open, everything is seen.
  const newestChange = shared.changes[0]?.id ?? 0
  if (shared.ready && (seenUpTo === null || (showRecent && seenUpTo !== newestChange))) {
    setSeenUpTo(newestChange)
  }
  const unseen = shared.changes.filter((c) => c.deviceId !== DEVICE_ID && c.id > (seenUpTo ?? Infinity)).length

  // Everything below is worked out from `event` + layout each time; nothing is stored twice.
  const statuses = useMemo(() => tableStatuses(live, event.families, event.reservations), [live, event])
  const owners = useMemo(() => chairOwners(event.families), [event.families])
  // Read fresh from the shared seating: if another device moves or removes the family, moving stops by itself.
  const moving: Family | null = (movingId && event.families.find((f) => f.id === movingId && f.status === 'seated')) || null
  const looks = useMemo(() => {
    const map = new Map<string, LiveTableLook>()
    const designed = new Map(layout.tables.map((t) => [t.id, t]))
    for (const t of live.tables) {
      const status = statuses.get(t.id)
      if (!status) continue
      const look = liveLook(status, owners, t.chairs.map((c) => c.id), t.chairs.filter((c) => c.kind !== 'highchair').length)
      // A held big group with no name: show its seat count (like the editor does), not "Big group T5".
      const dt = designed.get(t.id)
      if (status.reservation?.held && status.reservation.status !== 'seated' && dt?.kind === 'group' && !dt.guestName.trim()) {
        look.centerText = String(dt.seats)
      }
      look.checkedAt = shared.checks.get(t.id)
      // Big group tables of one party: one name spanning them all.
      if (status.reservation && dt?.kind === 'group') look.groupKey = `party:${status.reservation.id}`
      map.set(t.id, look)
    }
    return map
  }, [live, layout, statuses, owners, shared.checks])
  // While moving a family: tables with room for the whole family (not reserved, not where it sits now).
  const movableIds = useMemo(() => {
    if (!moving) return null
    const ids = new Set<string>()
    for (const [id, st] of statuses) if (id !== moving.tableId && !st.reservation && st.remaining >= moving.guestCount) ids.add(id)
    return ids
  }, [moving, statuses])
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
    if (moving) {
      if (movableIds?.has(tableId)) setOpenTableId(tableId)
      return
    }
    if (reserving) {
      if (!reservableIds.has(tableId)) return
      // From the newest list (not this render's copy), so tapping tables quickly never drops one.
      setReserving((picked) =>
        picked === null ? picked : picked.includes(tableId) ? picked.filter((id) => id !== tableId) : [...picked, tableId],
      )
      return
    }
    setOpenTableId(tableId)
  }

  /**
   * Double tap: one party takes all the table's open seats. On a reserved / held table, the party has
   * arrived: the whole reservation is seated (every one of its tables turns green).
   */
  async function fillTable(tableId: string) {
    if (reserving || moving) return
    const table = tablesById.get(tableId)
    const status = statuses.get(tableId)
    if (!table || !status) return
    const r = status.reservation
    if (r) {
      if (r.status !== 'reserved') return
      if (!(await perform({ type: 'seatReservation', reservationId: r.id })).ok) return
      setFilled({ text: `Seated ${r.name} at ${tableNames(r.tableIds).join(', ')}`, at: nowMs(), unseatId: r.id })
      return
    }
    const chairIds = table.chairs.filter((c) => c.kind !== 'highchair' && !owners.has(c.id)).map((c) => c.id)
    if (chairIds.length === 0) return
    const result = await perform({ type: 'createFamily', tableId, chairIds })
    if (!result.ok || !result.id) return
    setPartySize(null)
    setFilled({ familyId: result.id, text: `Seated ${chairIds.length} at ${table.name}`, at: nowMs() })
  }

  async function saveReservation(name: string, partySize: number) {
    if (!reserving) return
    if ((await perform({ type: 'createReservation', name, partySize, tableIds: reserving })).ok) setReserving(null)
  }

  function confirmSeat(r: Reservation) {
    setConfirm({
      title: `Seat ${r.name}?`,
      message: `Mark the party of ${r.partySize} as seated. ${r.tableIds.length > 1 ? 'All its tables' : 'The table'} (${tableNames(r.tableIds).join(', ')}) will turn green.`,
      confirmLabel: 'Seat party',
      onConfirm: async () => {
        if ((await perform({ type: 'seatReservation', reservationId: r.id })).ok) setOpenTableId(null)
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
      onConfirm: () => void perform({ type: 'cancelReservation', reservationId: r.id }),
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
      onConfirm: () => void perform({ type: 'clearTable', tableId }),
    })
  }

  function confirmEndSeating() {
    const special = layout.tables.filter((t) => t.kind !== 'regular').length
    const exact = layout.tables.filter((t) => t.normalSeats).length
    setConfirm({
      title: 'End live seating?',
      message:
        `All guests, reservations and holds are cleared` +
        (special > 0
          ? `, and all ${special} VIP / big group ${special === 1 ? 'table becomes a regular table' : 'tables become regular tables'} with their names removed`
          : '') +
        (exact > 0 ? `. ${exact === 1 ? 'The table' : `The ${exact} tables`} with an exact chair count get their normal chairs back` : '') +
        `. Wheelchair-accessible seats, highchairs and sections stay the same. This can't be undone. You'll go back to the menu.`,
      confirmLabel: 'End live seating',
      danger: true,
      onConfirm: () => void onEndSeating(shared.eventId),
    })
  }

  function confirmClearAll() {
    setConfirm({
      title: 'Clear all seating?',
      message: 'Every guest and reservation is cleared, and VIP / Big group tables are held again. Use this at the end of the night.',
      confirmLabel: 'Clear all seating',
      danger: true,
      onConfirm: async () => {
        if (!(await perform({ type: 'resetEvent', layout })).ok) return
        setOpenTableId(null)
        setReserving(null)
      },
    })
  }

  function goEdit() {
    if (seated === 0) {
      onEditLayout(occupiedTableIds(event))
      return
    }
    setConfirm({
      title: 'Edit the layout during service?',
      message: `${seated} guests are seated right now. Their seating is kept, but if you delete tables or remove chairs, guests on them are cleared.`,
      confirmLabel: 'Edit layout',
      onConfirm: () => onEditLayout(occupiedTableIds(event)),
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
          {moving ? (
            <div className="move-bar">
              <span>
                Moving <strong>family {moving.id}</strong> ({moving.guestCount}) from {tablesById.get(moving.tableId)?.name}: tap a
                table with {moving.guestCount} open {moving.guestCount === 1 ? 'seat' : 'seats'}
              </span>
              <button className="btn" onClick={() => setMovingId(null)}>
                Cancel
              </button>
            </div>
          ) : reserving ? (
            <ReservationBar
              tableNames={reservingTables.map((t) => t.name)}
              seatTotal={reservingTables.reduce((sum, t) => sum + t.chairs.filter((c) => c.kind !== 'highchair').length, 0)}
              onSave={(name, size) => void saveReservation(name, size)}
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
          {/* Hidden (not removed) while picking tables, so the floor below doesn't move between taps. */}
          <div className={reserving || moving ? 'live__strip-slot live__strip-slot--hidden' : 'live__strip-slot'} aria-hidden={!!(reserving || moving)}>
            <PartySizeBar size={partySize} onPick={setPartySize} note={suggestionNote} />
          </div>
          {/* Color key up here (not floating on the floor), so the floor can use the whole area below. */}
          <FloorLegend />
          <button
            className={`btn btn--ghost recent-btn${unseen > 0 ? ' recent-btn--new' : ''}`}
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
          >
            Recent changes
            {unseen > 0 && (
              <span className="recent-btn__badge" aria-label={`${unseen} new from other devices`}>
                {unseen}
              </span>
            )}
          </button>
        </div>
      )}

      <main className="app__main">
        {layout.tables.length === 0 ? (
          <div className="live__empty">
            <p>This restaurant has no tables yet.</p>
            <button className="btn btn--primary btn--large" onClick={() => onEditLayout(occupiedTableIds(event))}>
              Design the layout
            </button>
          </div>
        ) : !shared.ready ? (
          <div className="live__empty">
            <p>{shared.loadError || 'Loading the seating…'}</p>
          </div>
        ) : (
          <LiveFloor
            layout={layout}
            looks={looks}
            selectedTableIds={new Set(reserving ?? [])}
            selectableTableIds={reserving ? reservableIds : movableIds}
            onTableTap={handleTableTap}
            // While picking tables (reserve / move) every tap counts at once: no waiting to see if a second tap follows.
            onTableDoubleTap={reserving || moving ? undefined : (id) => void fillTable(id)}
            suggestedTableId={reserving || moving ? null : (suggestion?.tableId ?? null)}
          />
        )}
        {showRecent && (
          <RecentChanges
            changes={shared.changes}
            seenUpTo={seenUpTo ?? 0}
            onOpenTable={(id) => {
              setShowRecent(false)
              if (!moving && !reserving) setOpenTableId(id)
            }}
            onClose={() => setShowRecent(false)}
          />
        )}
      </main>

      {openTable && openStatus && (
        <TableDetail
          key={`${openTable.id}:${detailVersion}`}
          busy={shared.busy}
          table={openTable}
          // Moving a family here, or a party size picked: that many empty chairs (side by side) start selected.
          initialSelected={
            moving
              ? chairsForParty(openTable, owners, moving.guestCount)
              : partySize && !openStatus.reservation && openStatus.remaining >= partySize
                ? chairsForParty(openTable, owners, partySize)
                : undefined
          }
          moving={moving ?? undefined}
          checkedAt={shared.checks.get(openTable.id)}
          onCheck={() => void perform({ type: 'checkTable', tableId: openTable.id })}
          onUncheck={() => void perform({ type: 'uncheckTable', tableId: openTable.id })}
          onMoveFamily={(family) => {
            setOpenTableId(null)
            setPartySize(null)
            setMovingId(family.id)
          }}
          sectionName={sectionName(openTable.id)}
          status={openStatus}
          owners={owners}
          reservationTableNames={tableNames(openStatus.reservation?.tableIds ?? [])}
          onClose={() => setOpenTableId(null)}
          onCreateFamily={async (chairIds) => {
            if (moving) {
              const from = tablesById.get(moving.tableId)?.name ?? ''
              if (!(await perform({ type: 'moveFamily', familyId: moving.id, tableId: openTable.id, chairIds })).ok) return
              setFilled({ text: `Moved family ${moving.id} ${from} → ${openTable.name}`, at: nowMs() })
              setMovingId(null)
              setOpenTableId(null)
              return
            }
            if (!(await perform({ type: 'createFamily', tableId: openTable.id, chairIds })).ok) return
            setOpenTableId(null)
            setPartySize(null) // party seated: suggestion done
          }}
          onUpdateFamily={(familyId, chairIds) => void perform({ type: 'updateFamilyChairs', familyId, chairIds })}
          onFamilyDone={(familyId) => void perform({ type: 'markFamilyDone', familyId })}
          onRemoveFamily={(familyId) =>
            setConfirm({
              title: `Remove family ${familyId}?`,
              message: 'Use this only if the family was entered by mistake. Their chairs are freed.',
              confirmLabel: 'Remove',
              danger: true,
              onConfirm: () => void perform({ type: 'removeFamily', familyId }),
            })
          }
          onSeatReservation={confirmSeat}
          onCancelReservation={confirmRelease}
          onUnseatReservation={(r) => void perform({ type: 'unseatReservation', reservationId: r.id })}
          onClearTable={() => confirmClearTable(openTable.id)}
        />
      )}

      {notice ? (
        <div className="toast toast--error" role="alert" key={notice.at}>
          <span>{notice.text}</span>
          <button className="btn toast__undo" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      ) : (
        filled && (
          <div className="toast" role="status" key={filled.at}>
            <span>{filled.text}</span>
            {(filled.familyId || filled.unseatId) && (
              <button
                className="btn toast__undo"
                onClick={() => {
                  if (filled.familyId) void perform({ type: 'removeFamily', familyId: filled.familyId })
                  if (filled.unseatId) void perform({ type: 'unseatReservation', reservationId: filled.unseatId })
                  setFilled(null)
                }}
              >
                Undo
              </button>
            )}
          </div>
        )
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
