import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { RestaurantLayout } from '../types'
import type { Point } from '../logic/geometry'
import { DESIGN_CHAIR_RADIUS, clamp, contentBox, designTableBox } from '../logic/designTables'
import type { Box } from '../logic/designTables'
import { colors } from '../theme'
import { loadShowSections, saveShowSections } from '../state/viewPrefs'
import DesignTableShape from './DesignTableShape'
import type { LiveTableLook } from './DesignTableShape'
import DesignFeatureShape from './DesignFeatureShape'
import SectionOutline from './SectionOutline'
import SectionLabels from './SectionLabels'
import TableNameLabels from './TableNameLabels'
import type { TableName } from './TableNameLabels'
import ZoomControls from './ZoomControls'
import FloorLegend from './FloorLegend'

interface LiveFloorProps {
  layout: RestaurantLayout
  /** How each table looks right now (by table id). */
  looks: Map<string, LiveTableLook>
  /** Tables picked for a new reservation (orange outline). */
  selectedTableIds: Set<string>
  /** When set, only these tables can be tapped; the rest are faded. */
  selectableTableIds: Set<string> | null
  onTableTap: (tableId: string) => void
  /** Two quick taps on a table: fill all its open seats with one party. */
  onTableDoubleTap?: (tableId: string) => void
  /** Table suggested for the party size the hostess tapped: it glows softly. */
  suggestedTableId?: string | null
}

/** Pan offset (pixels) and zoom (pixels per layout unit). */
interface View {
  x: number
  y: number
  scale: number
}

/** A finger may wiggle this many pixels and still count as a tap. */
const TAP_SLOP = 10
/** At this zoom (pixels per layout unit) every table shows its chairs and table number. */
const SHOW_CHAIRS_SCALE = 12
/** Two taps on the same table within this many milliseconds count as a double tap. */
const DOUBLE_TAP_MS = 280

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Room kept free at the bottom of the "whole floor" view for the floating color key, in screen pixels. */
const KEY_ROOM = 56

/** View that fills the screen with `box` (the used part of the floor), centered, leaving `bottomRoom` px free. */
function fitView(width: number, height: number, box: Box, bottomRoom = 0): View {
  const usable = Math.max(1, height - bottomRoom)
  const bw = Math.max(1, box.maxX - box.minX)
  const bh = Math.max(1, box.maxY - box.minY)
  const scale = Math.min(width / bw, usable / bh) * 0.98
  return { scale, x: (width - bw * scale) / 2 - box.minX * scale, y: (usable - bh * scale) / 2 - box.minY * scale }
}

/** Zoom by `factor`, keeping the point (cx, cy) under the finger/mouse still. */
function zoomAt(base: View, factor: number, cx: number, cy: number, minScale: number, maxScale: number): View {
  const scale = clamp(base.scale * factor, minScale, maxScale)
  const k = scale / base.scale
  return { scale, x: cx - (cx - base.x) * k, y: cy - (cy - base.y) * k }
}

/** Soft, slowly pulsing glow behind the suggested table. */
function SuggestGlow({ table, scale }: { table: RestaurantLayout['tables'][number]; scale: number }) {
  const b = designTableBox(table, DESIGN_CHAIR_RADIUS)
  const r = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2) + 14 / scale
  return (
    <g pointerEvents="none">
      <circle className="suggest-glow" cx={table.x} cy={table.y} r={r} fill="#1F6F8B" />
      <circle cx={table.x} cy={table.y} r={r} fill="none" stroke="#1F6F8B" strokeWidth={2.5 / scale} strokeOpacity={0.7} />
    </g>
  )
}

/**
 * The hostess's floor: the designed layout with live table colors.
 * One finger pans, two fingers pinch-zoom, a tap on a table opens it. Nothing can be moved here.
 */
function LiveFloor({ layout, looks, selectedTableIds, selectableTableIds, onTableTap, onTableDoubleTap, suggestedTableId = null }: LiveFloorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [userView, setUserView] = useState<View | null>(null) // null = fit the whole floor
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ view: View; points: Point[]; moved: boolean } | null>(null)
  // Section tints and names can be switched off for a completely clean floor (remembered on this device).
  const [showSections, setShowSections] = useState(loadShowSections)
  useEffect(() => saveShowSections(showSections), [showSections])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // "Whole layout" view: the used part of the floor fills the screen, with room left for the floating key.
  const fit = useMemo(() => fitView(size.width, size.height, contentBox(layout), KEY_ROOM), [size, layout])
  const view = userView ?? fit
  // Can always zoom out far enough to see the entire floor, even though the fit view zooms to the tables.
  const minScale = Math.min(fit.scale, Math.min(size.width / layout.width, size.height / layout.height)) * 0.8
  const maxScale = Math.max(fit.scale * 10, 40)

  // Mouse wheel / trackpad zoom. Added by hand because React's wheel listener can't preventDefault.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      setUserView((prev) => zoomAt(prev ?? fit, Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top, minScale, maxScale))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fit, minScale, maxScale])

  function localPoint(e: PointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const first = pointers.current.size === 0
    pointers.current.set(e.pointerId, localPoint(e))
    // A second finger means pinch, never a tap.
    gesture.current = { view, points: [...pointers.current.values()], moved: !first || (gesture.current?.moved ?? false) }
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, localPoint(e))
    const points = [...pointers.current.values()]

    if (points.length === 1 && g.points.length === 1) {
      const dx = points[0].x - g.points[0].x
      const dy = points[0].y - g.points[0].y
      if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return
      gesture.current = { ...g, moved: true }
      setUserView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
    } else if (points.length >= 2 && g.points.length >= 2) {
      gesture.current = { ...g, moved: true }
      const startMid = midpoint(g.points[0], g.points[1])
      const mid = midpoint(points[0], points[1])
      const factor = distance(points[0], points[1]) / (distance(g.points[0], g.points[1]) || 1)
      const scale = clamp(g.view.scale * factor, minScale, maxScale)
      // The floor point that was under the fingers' midpoint stays under it.
      const worldX = (startMid.x - g.view.x) / g.view.scale
      const worldY = (startMid.y - g.view.y) / g.view.scale
      setUserView({ scale, x: mid.x - worldX * scale, y: mid.y - worldY * scale })
    }
  }

  // Telling one tap from two: the first tap waits a moment; a second tap on the same table in time is a double tap.
  const pendingTap = useRef<{ tableId: string; timer: number } | null>(null)
  // The delayed tap must call the screen's newest handler, not the one from when the finger went down
  // (that one can hold an out-of-date selection, e.g. the tables picked for a reservation so far).
  const latestTap = useRef(onTableTap)
  useEffect(() => {
    latestTap.current = onTableTap
  }, [onTableTap])
  useEffect(
    () => () => {
      if (pendingTap.current) window.clearTimeout(pendingTap.current.timer)
    },
    [],
  )

  function tableTapped(tableId: string) {
    const pending = pendingTap.current
    if (!onTableDoubleTap) {
      onTableTap(tableId)
      return
    }
    if (pending && pending.tableId === tableId) {
      window.clearTimeout(pending.timer)
      pendingTap.current = null
      onTableDoubleTap(tableId)
      return
    }
    if (pending) {
      // A different table: finish the earlier single tap right away.
      window.clearTimeout(pending.timer)
      onTableTap(pending.tableId)
    }
    const timer = window.setTimeout(() => {
      pendingTap.current = null
      latestTap.current(tableId)
    }, DOUBLE_TAP_MS)
    pendingTap.current = { tableId, timer }
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    const g = gesture.current
    const isTap = e.type === 'pointerup' && pointers.current.size === 1 && g !== null && !g.moved
    pointers.current.delete(e.pointerId)

    if (isTap) {
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-table-id]')
      const tableId = hit?.getAttribute('data-table-id')
      if (tableId) tableTapped(tableId)
    }

    gesture.current = pointers.current.size > 0 ? { view, points: [...pointers.current.values()], moved: true } : null
  }

  // A new suggestion that's off screen (zoomed in elsewhere): slide the floor so it's in the middle.
  // (React's "adjust state when a value changes" pattern: compare with the last suggestion we handled.)
  const [shownSuggestion, setShownSuggestion] = useState<string | null>(null)
  if (suggestedTableId !== shownSuggestion) {
    setShownSuggestion(suggestedTableId)
    const t = suggestedTableId ? layout.tables.find((x) => x.id === suggestedTableId) : undefined
    if (t && userView) {
      const sx = view.x + t.x * view.scale
      const sy = view.y + t.y * view.scale
      const margin = 60
      if (sx < margin || sy < margin || sx > size.width - margin || sy > size.height - margin) {
        setUserView({ ...view, x: size.width / 2 - t.x * view.scale, y: size.height / 2 - t.y * view.scale })
      }
    }
  }

  const zoomButtons = (factor: number) => setUserView(zoomAt(view, factor, size.width / 2, size.height / 2, minScale, maxScale))
  const zoomedIn = view.scale >= SHOW_CHAIRS_SCALE
  // Party / VIP names (anything that isn't a seat count), drawn in their own layer so they never overlap.
  const nameOf = useCallback(
    (t: RestaurantLayout['tables'][number]): TableName | null => {
      const look = looks.get(t.id)
      if (!look || look.centerText === '' || /^\d+$/.test(look.centerText)) return null
      // White text (seated, green table) would vanish once moved off the table: use dark ink instead.
      return {
        text: look.centerText,
        color: look.textColor === colors.white ? colors.ink : look.textColor,
        // Big group tables with the same party share one name across their combined width.
        groupKey: t.kind === 'group' ? `group:${look.centerText.toLowerCase()}` : undefined,
      }
    },
    [looks],
  )

  return (
    <div className="floor">
      <div
        className="floor__surface"
        ref={surfaceRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {size.width > 0 && (
          <svg width={size.width} height={size.height} aria-label="Restaurant floor">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              <rect width={layout.width} height={layout.height} rx={1} fill={colors.ground} stroke={colors.groundStroke} strokeWidth={0.3} />

              {showSections &&
                layout.sections.map((s) => (
                  <SectionOutline key={s.id} section={s} tables={layout.tables.filter((t) => t.sectionId === s.id)} />
                ))}

              {layout.features.map((f) => (
                <DesignFeatureShape key={f.id} feature={f} scale={view.scale} />
              ))}

              {layout.tables.map((t) => {
                const look = looks.get(t.id)
                const dimmed = selectableTableIds !== null && !selectableTableIds.has(t.id)
                return (
                  <g
                    key={t.id}
                    data-table-id={t.id}
                    className="floor-table"
                    opacity={dimmed ? 0.35 : 1}
                    role="button"
                    tabIndex={0}
                    aria-label={`Table ${t.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onTableTap(t.id)
                      }
                    }}
                  >
                    {t.id === suggestedTableId && <SuggestGlow table={t} scale={view.scale} />}
                    <DesignTableShape
                      table={t}
                      live={look}
                      selected={selectedTableIds.has(t.id)}
                      showChairs={zoomedIn}
                      scale={view.scale}
                      hideNames
                    />
                  </g>
                )
              })}

              {/* Section names, small, under each section; on top so the whole name always shows. */}
              {showSections && <SectionLabels layout={layout} scale={view.scale} />}

              {/* VIP / party names: middle of the table, or just above / below if another name is in the way. */}
              <TableNameLabels tables={layout.tables} nameOf={nameOf} scale={view.scale} zoomedIn={zoomedIn} />
            </g>
          </svg>
        )}
      </div>

      {/* Floating color key, bottom left. The whole-floor view keeps space for it, so it doesn't cover tables. */}
      <FloorLegend />

      <ZoomControls
        onZoomIn={() => zoomButtons(1.5)}
        onZoomOut={() => zoomButtons(1 / 1.5)}
        onFit={() => setUserView(null)}
        sectionsOn={showSections}
        onToggleSections={layout.sections.length > 0 ? () => setShowSections((on) => !on) : undefined}
      />
    </div>
  )
}

export default LiveFloor
