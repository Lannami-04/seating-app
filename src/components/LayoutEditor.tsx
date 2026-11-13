import { useEffect, useRef, useState } from 'react'
import type { DesignFeature, DesignSection, DesignTable, FeatureKind, RestaurantLayout, TableKind } from '../types'
import type { Point } from '../logic/geometry'
import {
  FEATURE_PRESETS,
  unusedSectionColor,
  alignInColumn,
  alignInRow,
  clamp,
  countKind,
  DESIGN_CHAIR_RADIUS,
  findFreeSpots,
  designTableBox,
  featureBox,
  featureCopySpots,
  findGroupCopyOffset,
  makeFeature,
  newId,
  nextTableNames,
  normalizeAngle,
  seatRule,
  spaceEvenly,
  totalSeats,
} from '../logic/designTables'
import { touchLayout } from '../state/layoutStorage'
import { emptyHistory, nowMs, recordChange, redo, undo } from '../state/undoHistory'
import EditorCanvas from './EditorCanvas'
import type { CanvasTarget, Move } from './EditorCanvas'
import NewTableDialog from './NewTableDialog'
import type { NewTableChoice } from './NewTableDialog'
import TablePanel from './TablePanel'
import FeaturePanel from './FeaturePanel'
import SectionPanel from './SectionPanel'
import SelectionPanel from './SelectionPanel'
import FloorSizeDialog from './FloorSizeDialog'
import ConfirmDialog from './ConfirmDialog'
import type { Arrangement } from './SelectionPanel'

interface LayoutEditorProps {
  layout: RestaurantLayout
  onChange: (layout: RestaurantLayout) => void
  onBack: () => void
  /** Switch to live seating for this layout. */
  onStartSeating: () => void
  /** Tables that have guests seated right now (deleting them asks first). */
  occupiedTableIds: Set<string>
}

/** Picking tables for a section. sectionId is null when making a brand-new section. */
interface Picking {
  sectionId: string | null
  name: string
  tableIds: string[]
}

/** The design screen: a canvas to place tables, stages, dividers and more, and group tables into sections. */
function LayoutEditor({ layout, onChange, onBack, onStartSeating, occupiedTableIds }: LayoutEditorProps) {
  const [selection, setSelection] = useState<CanvasTarget | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  // Many-select mode: ids of every selected table / room item. null = normal (one thing at a time).
  const [multi, setMulti] = useState<Set<string> | null>(null)
  // Short message at the bottom, e.g. "Deleted 5 tables", with an Undo button.
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null)
  // Waiting for "yes" before deleting tables that have guests seated during service.
  const [pendingDelete, setPendingDelete] = useState<Set<string> | null>(null)
  const [history, setHistory] = useState(emptyHistory)
  // The "+ Table" dialog, and the choices it opens with (remembers the last ones used).
  const [addingTables, setAddingTables] = useState(false)
  const [resizingFloor, setResizingFloor] = useState(false)
  const [lastChoice, setLastChoice] = useState<NewTableChoice>({ kind: 'regular', shape: 'circle', seats: 8, guestName: '', count: 1 })
  // Floor point in the middle of the screen (kept up to date by the canvas), for placing new things.
  const centerRef = useRef<Point>({ x: layout.width / 2, y: layout.height / 2 })

  const selectedTable = selection?.kind === 'table' ? layout.tables.find((t) => t.id === selection.id) : undefined
  const selectedFeature = selection?.kind === 'feature' ? layout.features.find((f) => f.id === selection.id) : undefined
  const selectedSection = selection?.kind === 'section' ? layout.sections.find((s) => s.id === selection.id) : undefined

  // ---------- Saving changes ----------

  /**
   * Every edit goes through here, so every edit can be undone.
   * Pass a mergeKey for edits that come in a stream (typing a name, sliding the angle) so they undo as one step.
   */
  function save(changes: Partial<RestaurantLayout>, mergeKey: string | null = null) {
    setHistory((h) => recordChange(h, layout, mergeKey, nowMs()))
    onChange(touchLayout({ ...layout, ...changes }))
  }

  /** Text and angle edits on the same item merge into one undo step; everything else is its own step. */
  function mergeKeyFor(id: string, changes: object): string | null {
    const keys = Object.keys(changes)
    const streaming = keys.length === 1 && ['guestName', 'label', 'name', 'rotation'].includes(keys[0])
    return streaming ? `${id}:${keys[0]}` : null
  }

  function updateTable(id: string, changes: Partial<DesignTable>) {
    save({ tables: layout.tables.map((t) => (t.id === id ? { ...t, ...changes } : t)) }, mergeKeyFor(id, changes))
  }

  function updateFeature(id: string, changes: Partial<DesignFeature>) {
    save({ features: layout.features.map((f) => (f.id === id ? { ...f, ...changes } : f)) }, mergeKeyFor(id, changes))
  }

  function updateSection(id: string, changes: Partial<DesignSection>) {
    save({ sections: layout.sections.map((s) => (s.id === id ? { ...s, ...changes } : s)) }, mergeKeyFor(id, changes))
  }

  // ---------- Undo / redo ----------

  function handleUndo() {
    const result = undo(history, layout)
    if (!result) return
    setHistory(result.history)
    onChange(touchLayout(result.layout))
  }

  function handleRedo() {
    const result = redo(history, layout)
    if (!result) return
    setHistory(result.history)
    onChange(touchLayout(result.layout))
  }

  // Keyboard (handy on a laptop): Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo (Cmd on Mac),
  // Delete / Backspace deletes what's selected, Escape lets go of the selection.
  // Inside a text box the keys are left alone, so they work on the typing like normal.
  const keyActions = useRef({ undo: handleUndo, redo: handleRedo, remove: deleteSelected, escape: clearSelection })
  useEffect(() => {
    keyActions.current = { undo: handleUndo, redo: handleRedo, remove: deleteSelected, escape: clearSelection }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      if (document.querySelector('.modal-backdrop')) return // a dialog is open
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) keyActions.current.undo()
        else if ((key === 'z' && e.shiftKey) || key === 'y') keyActions.current.redo()
        else return
        e.preventDefault()
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        keyActions.current.remove()
      } else if (key === 'escape') {
        keyActions.current.escape()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Hide the message after a few seconds.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  // ---------- Adding things ----------

  /** Middle of what's on screen, nudged a little each time so new room items don't stack exactly. */
  function dropPoint(): Point {
    const n = layout.features.length % 6
    return { x: centerRef.current.x + n * 2, y: centerRef.current.y + n * 2 }
  }

  /** Places `count` tables like `template` in free spots starting at (x, y). Returns how many fit. */
  function placeTables(template: DesignTable, count: number, x: number, y: number, selectFirst: boolean): number {
    const spots = findFreeSpots(template, count, x, y, layout.tables, layout)
    const names = nextTableNames(layout.tables, spots.length)
    const created = spots.map((p, i) => ({ ...template, id: newId('D'), name: names[i], x: p.x, y: p.y }))
    if (created.length === 0) return 0
    save({ tables: [...layout.tables, ...created] })
    if (selectFirst) setSelection(created.length === 1 ? { kind: 'table', id: created[0].id } : null)
    return created.length
  }

  function addTables(choice: NewTableChoice) {
    setLastChoice({ ...choice, guestName: '' })
    setAddingTables(false)
    const template: DesignTable = {
      id: '',
      name: '',
      shape: choice.shape,
      kind: choice.kind,
      guestName: choice.guestName,
      x: 0,
      y: 0,
      rotation: 0,
      seats: choice.seats,
      chairKinds: [],
      highchairs: 0,
      sectionId: null,
    }
    placeTables(template, choice.count, Math.round(centerRef.current.x), Math.round(centerRef.current.y), true)
  }

  function copyTable(table: DesignTable, count: number): number {
    return placeTables(table, count, table.x, table.y, false)
  }

  function addFeature(kind: FeatureKind) {
    const p = dropPoint()
    const feature = makeFeature(kind, p.x, p.y)
    save({ features: [...layout.features, feature] })
    setSelection({ kind: 'feature', id: feature.id })
  }

  // ---------- Sections ----------

  function startNewSection() {
    setSelection(null)
    setMulti(null)
    setPicking({ sectionId: null, name: '', tableIds: [] })
  }

  function startEditingSection(section: DesignSection) {
    setSelection(null)
    setPicking({
      sectionId: section.id,
      name: section.name,
      tableIds: layout.tables.filter((t) => t.sectionId === section.id).map((t) => t.id),
    })
  }

  function togglePicked(tableId: string) {
    if (!picking) return
    const has = picking.tableIds.includes(tableId)
    setPicking({ ...picking, tableIds: has ? picking.tableIds.filter((id) => id !== tableId) : [...picking.tableIds, tableId] })
  }

  function finishPicking() {
    if (!picking) return
    const name = picking.name.trim()
    const picked = new Set(picking.tableIds)
    let sections = layout.sections
    let sectionId = picking.sectionId
    if (sectionId === null) {
      sectionId = newId('S')
      sections = [...sections, { id: sectionId, name, color: nextSectionColor() }]
    } else {
      sections = sections.map((s) => (s.id === sectionId ? { ...s, name } : s))
    }
    const tables = layout.tables.map((t) => {
      if (picked.has(t.id)) return { ...t, sectionId }
      if (t.sectionId === sectionId) return { ...t, sectionId: null } // un-picked: leaves the section
      return t
    })
    save({ sections, tables })
    setPicking(null)
    setSelection({ kind: 'section', id: sectionId })
  }

  /** Next section color not already used (wraps around if all are taken). */
  function nextSectionColor(): string {
    return unusedSectionColor(layout.sections.map((s) => s.color))
  }

  function removeSection(id: string) {
    save({
      sections: layout.sections.filter((s) => s.id !== id),
      tables: layout.tables.map((t) => (t.sectionId === id ? { ...t, sectionId: null } : t)),
    })
    setSelection(null)
  }

  // ---------- Selecting ----------

  function clearSelection() {
    setSelection(null)
    setMulti(null)
  }

  /** Adds these to the group, or removes them if they're all in it already. */
  function toggleInMulti(ids: string[]) {
    const next = new Set(multi ?? [])
    const allIn = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (allIn) next.delete(id)
      else next.add(id)
    }
    setMulti(next)
  }

  function handleTap(target: CanvasTarget | null) {
    if (picking) {
      if (target?.kind === 'table') togglePicked(target.id)
      return
    }
    if (multi) {
      if (!target) return // tapping empty floor keeps the group (use Done to finish)
      // Tapping a section's name tag adds (or removes) all of its tables.
      const ids = target.kind === 'section' ? layout.tables.filter((t) => t.sectionId === target.id).map((t) => t.id) : [target.id]
      toggleInMulti(ids)
      return
    }
    setSelection(target)
  }

  function handleLongPress(target: CanvasTarget) {
    if (picking) return
    if (multi) {
      toggleInMulti([target.id])
      return
    }
    // Start many-select with this item, plus whatever was already open in the side panel.
    const start = new Set([target.id])
    if (selection && selection.kind !== 'section') start.add(selection.id)
    setSelection(null)
    setMulti(start)
  }

  function handleBoxSelect(ids: string[]) {
    if (picking) return
    const extra = !multi && selection && selection.kind !== 'section' ? [selection.id] : []
    setSelection(null)
    setMulti(new Set([...(multi ?? []), ...ids, ...extra]))
  }

  /** Saves new positions for any mix of tables and room items, as one undo step. */
  function applyMoves(moves: Move[]) {
    const byId = new Map(moves.map((m) => [m.id, m]))
    const place = <T extends { id: string; x: number; y: number }>(item: T): T => {
      const m = byId.get(item.id)
      return m ? { ...item, x: m.x, y: m.y } : item
    }
    save({ tables: layout.tables.map(place), features: layout.features.map(place) })
  }

  // ---------- Deleting ----------

  /**
   * Deletes right away (no "are you sure?") and offers Undo in a message instead —
   * except tables with guests seated right now, which ask first.
   */
  function deleteItems(ids: Set<string>, confirmed = false) {
    if (!confirmed && [...ids].some((id) => occupiedTableIds.has(id))) {
      setPendingDelete(ids)
      return
    }
    const tables = layout.tables.filter((t) => ids.has(t.id))
    const features = layout.features.filter((f) => ids.has(f.id))
    if (tables.length + features.length === 0) return
    save({ tables: layout.tables.filter((t) => !ids.has(t.id)), features: layout.features.filter((f) => !ids.has(f.id)) })
    const parts: string[] = []
    if (tables.length === 1) parts.push(`table ${tables[0].name}`)
    else if (tables.length > 1) parts.push(`${tables.length} tables`)
    if (features.length === 1) parts.push(`the ${FEATURE_PRESETS[features[0].kind].label.toLowerCase()}`)
    else if (features.length > 1) parts.push(`${features.length} room items`)
    setToast({ text: `Deleted ${parts.join(' and ')}`, at: nowMs() })
    clearSelection()
  }

  function deleteSelected() {
    if (multi) deleteItems(multi)
    else if (selection && selection.kind !== 'section') deleteItems(new Set([selection.id]))
  }

  // ---------- Acting on many at once ----------

  const multiTables = multi ? layout.tables.filter((t) => multi.has(t.id)) : []
  const multiFeatures = multi ? layout.features.filter((f) => multi.has(f.id)) : []

  function updateMultiTables(change: (t: DesignTable) => DesignTable) {
    save({ tables: layout.tables.map((t) => (multi?.has(t.id) ? change(t) : t)) })
  }

  function groupIntoNewSection(name: string) {
    const id = newId('S')
    save({
      sections: [...layout.sections, { id, name, color: nextSectionColor() }],
      tables: layout.tables.map((t) => (multi?.has(t.id) ? { ...t, sectionId: id } : t)),
    })
  }

  function groupKind(kind: TableKind) {
    updateMultiTables((t) => {
      const r = seatRule(t.shape, kind)
      const seats = clamp(t.seats, r.min, r.max)
      return { ...t, kind, seats, chairKinds: t.chairKinds.slice(0, seats) }
    })
  }

  function groupSeats(delta: 1 | -1) {
    updateMultiTables((t) => {
      const r = seatRule(t.shape, t.kind)
      const seats = clamp(t.seats + delta * r.step, r.min, r.max)
      return { ...t, seats, chairKinds: t.chairKinds.slice(0, seats) }
    })
  }

  function groupTurn(degrees: number) {
    const turn = <T extends { id: string; rotation: number }>(item: T): T =>
      multi?.has(item.id) ? { ...item, rotation: normalizeAngle(item.rotation + degrees) } : item
    save({ tables: layout.tables.map(turn), features: layout.features.map(turn) })
  }

  function groupArrange(how: Arrangement) {
    const items = [...multiTables, ...multiFeatures].map((i) => ({ id: i.id, x: i.x, y: i.y }))
    applyMoves(how === 'row' ? alignInRow(items) : how === 'column' ? alignInColumn(items) : spaceEvenly(items))
  }

  /** Copies everything selected (tables and room items) beside the group, then selects the copy. */
  function groupCopy(): boolean {
    const tableBox = (t: DesignTable) => designTableBox(t, DESIGN_CHAIR_RADIUS)
    const groupBoxes = [...multiTables.map(tableBox), ...multiFeatures.map(featureBox)]
    const otherBoxes = [
      ...layout.tables.filter((t) => !multi?.has(t.id)).map(tableBox),
      ...layout.features.filter((f) => !multi?.has(f.id)).map(featureBox),
    ]
    const offset = findGroupCopyOffset(groupBoxes, otherBoxes, layout)
    if (!offset) return false
    const names = nextTableNames(layout.tables, multiTables.length)
    const tableCopies = multiTables.map((t, i) => ({ ...t, id: newId('D'), name: names[i], x: t.x + offset.dx, y: t.y + offset.dy }))
    const featureCopies = multiFeatures.map((f) => ({ ...f, id: newId('F'), x: f.x + offset.dx, y: f.y + offset.dy }))
    save({ tables: [...layout.tables, ...tableCopies], features: [...layout.features, ...featureCopies] })
    setMulti(new Set([...tableCopies, ...featureCopies].map((c) => c.id)))
    return true
  }

  /** Copies of one room item side by side next to it. Returns how many fit. */
  function copyFeature(f: DesignFeature, count: number): number {
    const others = [
      ...layout.tables.map((t) => designTableBox(t, DESIGN_CHAIR_RADIUS)),
      ...layout.features.filter((o) => o.id !== f.id).map(featureBox),
    ]
    const spots = featureCopySpots(f, count, others, layout)
    if (spots.length === 0) return 0
    save({ features: [...layout.features, ...spots.map((p) => ({ ...f, id: newId('F'), x: p.x, y: p.y }))] })
    return spots.length
  }

  function startSelectMany() {
    setSelection(null)
    setMulti(new Set())
  }

  // Everything on the floor, for the smallest allowed floor size.
  const occupied = [...layout.tables.map((t) => designTableBox(t, DESIGN_CHAIR_RADIUS)), ...layout.features.map(featureBox)]

  const wheelchairs = countKind(layout.tables, 'wheelchair')
  const highchairs = countKind(layout.tables, 'highchair')

  return (
    <div className="app">
      <header className="topbar editor__bar">
        <div className="editor__title">
          <button className="btn btn--ghost btn--icon" onClick={onBack} aria-label="Back to my restaurants">
            ‹
          </button>
          <div>
            <h1 className="editor__name">{layout.name}</h1>
            <p className="editor__meta">
              {layout.tables.length} {layout.tables.length === 1 ? 'table' : 'tables'} · {totalSeats(layout.tables)} seats
              {wheelchairs > 0 && ` · ${wheelchairs} ♿`}
              {highchairs > 0 && ` · ${highchairs} highchair${highchairs === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {picking ? (
          <div className="topbar__actions pickbar">
            <input
              className="input"
              placeholder="Section name, e.g. Hibiscus"
              value={picking.name}
              maxLength={24}
              onChange={(e) => setPicking({ ...picking, name: e.target.value })}
              autoFocus={picking.sectionId === null}
            />
            <span className="pickbar__count">
              {picking.tableIds.length === 0 ? 'Tap tables to add them' : `${picking.tableIds.length} picked`}
            </span>
            <button className="btn" onClick={() => setPicking(null)}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={finishPicking} disabled={!picking.name.trim() || picking.tableIds.length === 0}>
              {picking.sectionId ? 'Save section' : 'Make section'}
            </button>
          </div>
        ) : (
          <div className="editor__tools">
            <div className="topbar__actions">
              <span className="editor__add-label">Tables</span>
              <button className="btn btn--primary" onClick={() => setAddingTables(true)}>
                + Table
              </button>
              <button className="btn" onClick={startNewSection} disabled={layout.tables.length === 0}>
                + Section
              </button>
              <button
                className={`btn${multi ? ' btn--on' : ''}`}
                onClick={multi ? clearSelection : startSelectMany}
                disabled={layout.tables.length + layout.features.length === 0}
                aria-pressed={multi !== null}
              >
                {multi ? 'Stop selecting' : 'Select many'}
              </button>
            </div>
            <div className="topbar__actions">
              <span className="editor__add-label">Room</span>
              {(Object.keys(FEATURE_PRESETS) as FeatureKind[]).map((kind) => (
                <button key={kind} className="btn" onClick={() => addFeature(kind)}>
                  + {FEATURE_PRESETS[kind].label}
                </button>
              ))}
              <button className="btn" onClick={() => setResizingFloor(true)}>
                Floor size
              </button>
            </div>
          </div>
        )}

        {/* Far right, away from the design tools. */}
        <button className="btn btn--primary editor__go-live" onClick={onStartSeating} disabled={layout.tables.length === 0}>
          Start seating ▶
        </button>
      </header>

      <main className="app__main editor__main">
        <EditorCanvas
          layout={layout}
          selection={selection}
          multiIds={multi}
          pickedIds={picking ? new Set(picking.tableIds) : null}
          hiddenSectionId={picking?.sectionId ?? null}
          onTap={handleTap}
          onLongPress={handleLongPress}
          onBoxSelect={handleBoxSelect}
          onMove={applyMoves}
          onResize={(id, change) => updateFeature(id, change)}
          centerRef={centerRef}
          topLeft={
            <>
              <button className="btn undo-btn" onClick={handleUndo} disabled={history.past.length === 0} title="Undo (Ctrl+Z)">
                <span aria-hidden="true">↶</span> Undo
              </button>
              <button className="btn undo-btn" onClick={handleRedo} disabled={history.future.length === 0} title="Redo (Ctrl+Shift+Z)">
                <span aria-hidden="true">↷</span> Redo
              </button>
            </>
          }
        />

        {multi && (
          <SelectionPanel
            tables={multiTables}
            features={multiFeatures}
            sections={layout.sections}
            onDelete={() => deleteItems(multi)}
            onDone={clearSelection}
            onSection={(sectionId) => updateMultiTables((t) => ({ ...t, sectionId }))}
            onNewSection={groupIntoNewSection}
            onKind={groupKind}
            onName={(guestName) => save(
              { tables: layout.tables.map((t) => (multi?.has(t.id) && t.kind !== 'regular' ? { ...t, guestName } : t)) },
              'group-name', // typing a name is one undo step
            )}
            onSeats={groupSeats}
            onTurn={groupTurn}
            onArrange={groupArrange}
            onCopy={groupCopy}
          />
        )}

        {selectedTable && (
          <TablePanel
            key={selectedTable.id}
            table={selectedTable}
            sections={layout.sections}
            onChange={(changes) => updateTable(selectedTable.id, changes)}
            onOpenSection={(id) => setSelection({ kind: 'section', id })}
            onCopy={(count) => copyTable(selectedTable, count)}
            onDelete={deleteSelected}
            onDone={() => setSelection(null)}
          />
        )}
        {selectedFeature && (
          <FeaturePanel
            key={selectedFeature.id}
            feature={selectedFeature}
            onChange={(changes) => updateFeature(selectedFeature.id, changes)}
            onCopy={(count) => copyFeature(selectedFeature, count)}
            onDelete={deleteSelected}
            onDone={() => setSelection(null)}
          />
        )}
        {selectedSection && (
          <SectionPanel
            key={selectedSection.id}
            section={selectedSection}
            tables={layout.tables.filter((t) => t.sectionId === selectedSection.id)}
            usedColors={layout.sections.filter((s) => s.id !== selectedSection.id).map((s) => s.color)}
            onChange={(changes) => updateSection(selectedSection.id, changes)}
            onEditTables={() => startEditingSection(selectedSection)}
            onRemove={() => removeSection(selectedSection.id)}
            onSelectTables={() => {
              setSelection(null)
              setMulti(new Set(layout.tables.filter((t) => t.sectionId === selectedSection.id).map((t) => t.id)))
            }}
            onDone={() => setSelection(null)}
          />
        )}
      </main>

      {resizingFloor && (
        <FloorSizeDialog
          width={layout.width}
          height={layout.height}
          // Never smaller than what's already placed (rounded up to the next 10, plus a little room).
          minWidth={Math.max(50, Math.ceil((Math.max(0, ...occupied.map((b) => b.maxX)) + 2) / 10) * 10)}
          minHeight={Math.max(50, Math.ceil((Math.max(0, ...occupied.map((b) => b.maxY)) + 2) / 10) * 10)}
          onCancel={() => setResizingFloor(false)}
          onSave={(width, height) => {
            if (width !== layout.width || height !== layout.height) save({ width, height })
            setResizingFloor(false)
          }}
        />
      )}

      {addingTables && <NewTableDialog initial={lastChoice} onCreate={addTables} onCancel={() => setAddingTables(false)} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete a table with guests?"
          message={`Guests are seated at ${layout.tables
            .filter((t) => pendingDelete.has(t.id) && occupiedTableIds.has(t.id))
            .map((t) => t.name)
            .join(', ')} right now. Delete anyway? Their seating will be cleared.`}
          confirmLabel="Delete anyway"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteItems(pendingDelete, true)
            setPendingDelete(null)
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" key={toast.at}>
          <span>{toast.text}</span>
          <button
            className="btn toast__undo"
            onClick={() => {
              handleUndo()
              setToast(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

export default LayoutEditor
