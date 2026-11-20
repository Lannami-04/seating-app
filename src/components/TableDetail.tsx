import { useState } from 'react'
import type { Chair as ChairData, Family, Reservation, Table } from '../types'
import type { TableStatus } from '../logic/seating'
import { TABLE_SCALE, chairPositions, seatCount, tableBounds, tableSize } from '../logic/geometry'
import { pickFamilyColor } from '../logic/familyColors'
import { clockTime } from '../logic/clock'
import { colors } from '../theme'
import Chair from './Chair'
import FamilyLegend from './FamilyLegend'
import FamilyMenu from './FamilyMenu'
import ReservationPanel from './ReservationPanel'

interface TableDetailProps {
  table: Table
  sectionName: string
  status: TableStatus
  owners: Map<string, Family>
  /** Names of all tables in this table's reservation (if any). */
  reservationTableNames: string[]
  onClose: () => void
  onCreateFamily: (chairIds: string[]) => void
  onUpdateFamily: (familyId: string, chairIds: string[]) => void
  onFamilyDone: (familyId: string) => void
  onRemoveFamily: (familyId: string) => void
  onSeatReservation: (reservation: Reservation) => void
  onCancelReservation: (reservation: Reservation) => void
  onUnseatReservation: (reservation: Reservation) => void
  onClearTable: () => void
  /** Chairs to have selected when the table opens (from the party-size suggestion). */
  initialSelected?: string[]
  /** A change is being saved to the database: the save buttons wait. */
  busy?: boolean
  /** Start moving a family to another table (the floor then asks for the new table). */
  onMoveFamily: (family: Family) => void
  /** A family being moved here from another table: pick its chairs, then "Move here". */
  moving?: Family
  /** "Checked": someone looked at this table on the real floor and it matches. */
  onCheck: () => void
  /** When the table was last checked (ms), if ever this event. */
  checkedAt?: number
}

/**
 * The free seat closest to a family's chairs (seats are numbered around the table), so "+1 seat" keeps
 * the family together. Wheelchair-accessible seats are used last. Null if no seat is free.
 */
function closestFreeSeat(table: Table, owners: Map<string, Family>, family: Family): string | null {
  const seats = table.chairs.filter((c) => c.kind !== 'highchair')
  const n = seats.length
  const mine = seats.map((c, i) => (family.chairIds.includes(c.id) ? i : -1)).filter((i) => i >= 0)
  let best: { id: string; cost: number } | null = null
  seats.forEach((c, i) => {
    if (owners.has(c.id)) return
    const ring = mine.length ? Math.min(...mine.map((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)))) : 0
    const cost = ring + (c.kind === 'wheelchair' ? n : 0)
    if (!best || cost < best.cost) best = { id: c.id, cost }
  })
  return (best as { id: string } | null)?.id ?? null
}

const CHAIR_RADIUS = 1.0 * TABLE_SCALE
const PADDING = 0.8

/**
 * Full-screen view of one table with big tappable chairs.
 * Remembers which chairs are picked; the actual seating change is sent up to App.
 * App renders this with key={table.id}, so this state starts fresh for every table.
 */
function TableDetail(props: TableDetailProps) {
  const { table, sectionName, status, owners, reservationTableNames, onClose } = props
  const [selected, setSelected] = useState<string[]>(props.initialSelected ?? [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const reservation = status.reservation
  const editingFamily = status.families.find((f) => f.id === editingId)
  const menuFamily = status.families.find((f) => f.id === menuId)
  const newFamilyColor = pickFamilyColor(status.families)

  function resetSelection() {
    setSelected([])
    setEditingId(null)
    setMenuId(null)
  }

  function toggle(chairId: string) {
    setSelected((prev) => (prev.includes(chairId) ? prev.filter((id) => id !== chairId) : [...prev, chairId]))
  }

  function handleChairTap(chair: ChairData) {
    const owner = owners.get(chair.id)
    if (editingId) {
      // While editing, only this family's chairs and empty chairs can be toggled.
      if (!owner || owner.id === editingId) toggle(chair.id)
      return
    }
    if (owner) {
      if (selected.length === 0) setMenuId(owner.id)
      return
    }
    setMenuId(null)
    toggle(chair.id)
  }

  function startEditing(family: Family) {
    setEditingId(family.id)
    setSelected(family.chairIds)
    setMenuId(null)
  }

  /** Color and label for one chair, depending on who sits there and what is selected. */
  function chairLook(chair: ChairData): { color: string; textColor: string; isSelected: boolean; who: string } {
    if (reservation) {
      const seated = reservation.status === 'seated'
      return {
        color: seated ? colors.tableFull : colors.chairReserved,
        textColor: seated ? colors.white : colors.ink,
        isSelected: false,
        who: `reserved for ${reservation.name}`,
      }
    }
    const isSelected = selected.includes(chair.id)
    const owner = owners.get(chair.id)
    if (editingFamily && (owner?.id === editingFamily.id || isSelected)) {
      return isSelected
        ? { color: editingFamily.color, textColor: colors.white, isSelected, who: `family ${editingFamily.id}` }
        : { color: colors.chairFree, textColor: colors.ink, isSelected, who: 'will be freed' }
    }
    if (owner) return { color: owner.color, textColor: colors.white, isSelected: false, who: `family ${owner.id}` }
    if (isSelected) return { color: newFamilyColor, textColor: colors.white, isSelected, who: 'selected' }
    return { color: colors.chairFree, textColor: colors.ink, isSelected: false, who: 'available' }
  }

  const bounds = tableBounds(table, CHAIR_RADIUS)
  const viewBox = [
    bounds.minX - PADDING,
    bounds.minY - PADDING,
    bounds.width + PADDING * 2,
    bounds.height + PADDING * 2,
  ].join(' ')
  const { width, height } = tableSize(table)
  const positions = chairPositions(table)
  const canClear = status.families.length > 0 || reservation !== undefined
  // Every open real seat (highchairs are extras, added by hand).
  const openSeatIds = table.chairs.filter((c) => c.kind !== 'highchair' && !owners.has(c.id)).map((c) => c.id)

  const seats = seatCount(table)
  const wheelchairs = table.chairs.filter((c) => c.kind === 'wheelchair').length
  const highchairs = table.chairs.length - seats
  const extras = [
    wheelchairs > 0 ? `${wheelchairs} wheelchair accessible` : '',
    highchairs > 0 ? `+${highchairs} highchair${highchairs === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const subtitle = [
    `${seats} seats`,
    ...extras,
    reservation ? 'reserved' : `${status.remaining} open`,
    props.checkedAt ? `checked ${clockTime(props.checkedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const moving = props.moving

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={`Table ${table.name}`}>
      <header className="detail__header">
        <button className="btn" onClick={onClose}>
          ‹ Floor plan
        </button>
        <div className="detail__title">
          <h2>
            {table.name} <span className="detail__section">{sectionName}</span>
          </h2>
          <div className="detail__subtitle">{subtitle}</div>
        </div>
        <div className="detail__header-actions">
          <button
            className="btn detail__check"
            onClick={props.onCheck}
            disabled={props.busy}
            title="Tap after looking at this table on the floor: it matches what the app shows"
          >
            ✓ Checked
          </button>
          <button className="btn btn--quiet-danger" onClick={props.onClearTable} disabled={!canClear || !!moving}>
            Clear table
          </button>
        </div>
      </header>

      <div className="detail__body">
        <div className="detail__table">
          <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="detail__svg">
            <g fill={status.isFull ? colors.tableFull : colors.tableFree} stroke={colors.tableFreeStroke} strokeWidth={0.08}>
              {table.shape === 'circle' ? (
                <circle r={width / 2} />
              ) : (
                <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={0.3} />
              )}
            </g>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(height * 0.3, 1.4)}
              fill={status.isFull ? colors.white : colors.inkMuted}
              className="detail__table-name"
            >
              {table.name}
            </text>
            {table.chairs.map((chair, i) => {
              const look = chairLook(chair)
              const kindText = chair.kind === 'standard' ? '' : `, ${chair.kind} spot`
              return (
                <Chair
                  key={chair.id}
                  chair={chair}
                  x={positions[i].x}
                  y={positions[i].y}
                  radius={CHAIR_RADIUS}
                  color={look.color}
                  textColor={look.textColor}
                  isSelected={look.isSelected}
                  disabled={reservation !== undefined}
                  description={`Chair ${chair.number}${kindText}, ${look.who}`}
                  onTap={() => handleChairTap(chair)}
                />
              )
            })}
          </svg>
        </div>

        <aside className="detail__side">
          {reservation ? (
            <ReservationPanel
              reservation={reservation}
              tableNames={reservationTableNames}
              onSeat={() => props.onSeatReservation(reservation)}
              onCancel={() => props.onCancelReservation(reservation)}
              onUnseat={() => props.onUnseatReservation(reservation)}
              busy={props.busy}
            />
          ) : (
            <>
              <h3 className="detail__side-title">Families</h3>
              <FamilyLegend
                families={status.families}
                activeFamilyId={editingId ?? menuId}
                onSelect={(id) => {
                  if (!editingId && selected.length === 0) setMenuId(id === menuId ? null : id)
                }}
              />
              {menuFamily && !editingId && (
                <FamilyMenu
                  family={menuFamily}
                  busy={props.busy}
                  onMove={() => props.onMoveFamily(menuFamily)}
                  onAddSeat={(() => {
                    const free = closestFreeSeat(table, owners, menuFamily)
                    return free ? () => props.onUpdateFamily(menuFamily.id, [...menuFamily.chairIds, free]) : null
                  })()}
                  onRemoveSeat={
                    menuFamily.chairIds.length > 1
                      ? () => props.onUpdateFamily(menuFamily.id, menuFamily.chairIds.slice(0, -1))
                      : null
                  }
                  onEditChairs={() => startEditing(menuFamily)}
                  onDone={() => {
                    props.onFamilyDone(menuFamily.id)
                    setMenuId(null)
                  }}
                  onRemove={() => {
                    props.onRemoveFamily(menuFamily.id)
                    setMenuId(null)
                  }}
                  onClose={() => setMenuId(null)}
                />
              )}
            </>
          )}
        </aside>
      </div>

      {/* The footer is always shown so the table area never resizes (chairs would jump under the finger). */}
      <footer className="detail__footer">
        <div className="detail__footer-text">
          {moving
            ? `Moving family ${moving.id} here · ${selected.length} of ${moving.guestCount} chairs picked. Tap chairs to change.`
            : editingFamily
            ? `Editing ${editingFamily.id}: tap chairs to add or remove · ${selected.length} selected`
            : selected.length > 0
              ? `New family · ${selected.length} ${selected.length === 1 ? 'chair' : 'chairs'}`
              : reservation
                ? 'This table belongs to a reservation.'
                : status.remaining > 0
                  ? 'Tap gray chairs to seat a new family.'
                  : 'Table is full. Tap a family to edit or finish it.'}
        </div>
        {(selected.length > 0 || editingFamily) && (
          <button className="btn btn--large" onClick={resetSelection}>
            Cancel
          </button>
        )}
        {editingFamily ? (
          <button
            className="btn btn--primary btn--large"
            disabled={selected.length === 0 || props.busy}
            onClick={() => {
              props.onUpdateFamily(editingFamily.id, selected)
              resetSelection()
            }}
          >
            Save
          </button>
        ) : (
          <>
            {/* One tap: a single party takes every open seat (wheelchair-accessible seats too, not highchairs). */}
            {!moving && selected.length === 0 && !reservation && openSeatIds.length > 0 && (
              <button className="btn btn--large" onClick={() => props.onCreateFamily(openSeatIds)} disabled={props.busy}>
                Fill table ({openSeatIds.length})
              </button>
            )}
            {selected.length > 0 && (
              <button className="btn btn--primary btn--large" onClick={() => props.onCreateFamily(selected)} disabled={props.busy}>
                {props.busy ? 'Saving…' : moving ? 'Move here' : 'Done'}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  )
}

export default TableDetail
