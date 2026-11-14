import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode, RefObject } from 'react'
import type { DesignFeature, RestaurantLayout } from '../types'
import type { Point } from '../logic/geometry'
import { TABLE_KINDS, clamp, contentBox } from '../logic/designTables'
import type { Box } from '../logic/designTables'
import { colors } from '../theme'
import { loadShowSections, saveShowSections } from '../state/viewPrefs'
import DesignTableShape from './DesignTableShape'
import DesignFeatureShape from './DesignFeatureShape'
import SectionOutline from './SectionOutline'
import SectionLabels from './SectionLabels'
import TableNameLabels from './TableNameLabels'
import type { TableName } from './TableNameLabels'
import ZoomControls from './ZoomControls'

export type CanvasTarget = { kind: 'table' | 'feature' | 'section'; id: string }

/** A table or room item that ended up somewhere new after a drag. */
export interface Move {
  id: string
  x: number
  y: number
}

interface EditorCanvasProps {
  layout: RestaurantLayout
  /** The one thing being edited in the side panel. */
  selection: CanvasTarget | null
  /** Many-select mode: ids of every selected table / room item (null = not in that mode). */
  multiIds: Set<string> | null
  /** While building a section the old way: the tables picked so far. */
  pickedIds: Set<string> | null
  /** Section whose outline is hidden while its tables are being re-picked. */
  hiddenSectionId: string | null
  /** A short tap on something (or on empty floor: null). */
  onTap: (target: CanvasTarget | null) => void
  /** Holding a finger still on a table or room item. */
  onLongPress: (target: CanvasTarget) => void
  /** Hold on empty floor, then drag: everything whose center is inside the box. */
  onBoxSelect: (ids: string[]) => void
  /** Selected things were dragged to new spots. */
  onMove: (moves: Move[]) => void
  /** A room item was stretched with its handles: new center and size. */
  onResize: (id: string, change: Pick<DesignFeature, 'x' | 'y' | 'width' | 'height'>) => void
  /** Floating buttons drawn in the top-left corner of the floor (undo / redo). */
  topLeft?: ReactNode
  /** Kept up to date with the floor point in the middle of the screen, for placing new tables. */
  centerRef: RefObject<Point>
}

/** Pan offset (pixels) and zoom (pixels per layout unit). */
interface View {
  x: number
  y: number
  scale: number
}

interface Gesture {
  view: View
  points: Point[]
  moved: boolean
  /** True once a long press fired, so lifting the finger isn't also a tap. */
  longPressed: boolean
  /** What the first finger landed on. */
  target: CanvasTarget | null
  /** Dragging selected things: where the finger started (floor units) and where each item started. */
  dragging: { startX: number; startY: number; items: Move[] } | null
  /** Drawing a selection box: its first corner (floor units). */
  boxStart: Point | null
  /** Stretching a room item by one of its handles. */
  resizing: Handle | null
}

/** A stretch handle: which room item, along its length ('w') or depth ('h'), and which end (+1 / -1). */
interface Handle {
  id: string
  axis: 'w' | 'h'
  side: 1 | -1
}

/** Smallest length / depth a room item can be stretched to. */
const minSize = (f: DesignFeature, axis: 'w' | 'h') => (axis === 'w' ? 2 : f.kind === 'divider' ? 0.8 : 1)

/**
 * New center and size when one end of a (possibly turned) room item is dragged to point p.
 * The opposite end stays where it is.
 */
function stretch(f: DesignFeature, h: Handle, p: Point, floor: { width: number; height: number }, knobOffset: number) {
  const a = (f.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // The finger's position measured along the item's own length (u) and depth (v) directions.
  const dx = p.x - f.x
  const dy = p.y - f.y
  // The knob sits `knobOffset` past the end, so the end itself is that much closer than the finger.
  const along = (h.axis === 'w' ? dx * cos + dy * sin : -dx * sin + dy * cos) - h.side * knobOffset
  const size = h.axis === 'w' ? f.width : f.height
  const fixedEnd = (-h.side * size) / 2
  const maxSize = Math.max(floor.width, floor.height)
  const newSize = clamp(snap((along - fixedEnd) * h.side), minSize(f, h.axis), maxSize)
  // Move the center so the fixed end doesn't move.
  const shift = fixedEnd + (h.side * newSize) / 2
  const [ux, uy] = h.axis === 'w' ? [cos, sin] : [-sin, cos]
  return {
    x: f.x + ux * shift,
    y: f.y + uy * shift,
    width: h.axis === 'w' ? newSize : f.width,
    height: h.axis === 'h' ? newSize : f.height,
  }
}

/** A finger may wiggle this many pixels and still count as a tap. */
const TAP_SLOP = 10
/** Hold this long (ms) for a long press. */
const LONG_PRESS_MS = 500
/** At this zoom (pixels per layout unit) every table shows its individual chairs. */
const SHOW_CHAIRS_SCALE = 12
const GRID = 5
const SNAP = 0.5

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const snap = (v: number) => Math.round(v / SNAP) * SNAP

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

/** What's under the finger: a table, a room item, a section name tag, or nothing. */
function handleAt(el: EventTarget | null): Handle | null {
  if (!(el instanceof Element)) return null
  const h = el.closest('[data-handle-id]')
  if (!h) return null
  return {
    id: h.getAttribute('data-handle-id') ?? '',
    axis: h.getAttribute('data-handle-axis') === 'h' ? 'h' : 'w',
    side: h.getAttribute('data-handle-side') === '-1' ? -1 : 1,
  }
}

function targetAt(el: EventTarget | null): CanvasTarget | null {
  if (!(el instanceof Element)) return null
  const item = el.closest('[data-item-id]')
  if (item) return { kind: item.getAttribute('data-item-kind') as 'table' | 'feature', id: item.getAttribute('data-item-id') ?? '' }
  const section = el.closest('[data-section-id]')
  if (section) return { kind: 'section', id: section.getAttribute('data-section-id') ?? '' }
  return null
}

const boxFrom = (a: Point, b: Point): Box => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
})

/**
 * Round handles on a selected room item: drag one to stretch it from that end.
 * Dividers only stretch in length; other items also get handles for depth.
 */
function StretchHandles({ feature, scale }: { feature: DesignFeature; scale: number }) {
  const r = 10 / scale // ~20px knob on screen
  const hit = 18 / scale // ~36px touch circle around the knob
  // Knobs sit out past the ends on a short stem, so their touch area never covers the item itself:
  // grabbing the item (even a short, thin divider) always moves it; only the knobs stretch it.
  const out = 44 / scale
  const handles: { axis: 'w' | 'h'; side: 1 | -1; x: number; y: number; ex: number; ey: number }[] = [
    { axis: 'w', side: -1, x: -feature.width / 2 - out, y: 0, ex: -feature.width / 2, ey: 0 },
    { axis: 'w', side: 1, x: feature.width / 2 + out, y: 0, ex: feature.width / 2, ey: 0 },
  ]
  if (feature.kind !== 'divider') {
    handles.push(
      { axis: 'h', side: -1, x: 0, y: -feature.height / 2 - out, ex: 0, ey: -feature.height / 2 },
      { axis: 'h', side: 1, x: 0, y: feature.height / 2 + out, ex: 0, ey: feature.height / 2 },
    )
  }
  return (
    <g transform={`translate(${feature.x} ${feature.y}) rotate(${feature.rotation})`}>
      {handles.map((h) => (
        <g key={`${h.axis}${h.side}`}>
          {/* Stem from the item's end to its knob. */}
          <line
            x1={h.ex}
            y1={h.ey}
            x2={h.x}
            y2={h.y}
            stroke={colors.selection}
            strokeWidth={2 / scale}
            strokeDasharray={`${4 / scale} ${3 / scale}`}
            pointerEvents="none"
          />
          <g
            data-handle-id={feature.id}
            data-handle-axis={h.axis}
            data-handle-side={h.side}
            className={h.axis === 'w' ? 'stretch-handle stretch-handle--w' : 'stretch-handle stretch-handle--h'}
          >
            <circle cx={h.x} cy={h.y} r={hit} fill="transparent" />
            <circle cx={h.x} cy={h.y} r={r} fill={colors.white} stroke={colors.selection} strokeWidth={3 / scale} />
            {/* Two-way arrow: "stretch", not "move". */}
            <path
              d={h.axis === 'w' ? `M ${h.x - r * 0.55} ${h.y} H ${h.x + r * 0.55}` : `M ${h.x} ${h.y - r * 0.55} V ${h.y + r * 0.55}`}
              stroke={colors.selection}
              strokeWidth={2.5 / scale}
              strokeLinecap="round"
            />
          </g>
        </g>
      ))}
      {/* Current size while you look at it, e.g. "12 × 0.8". */}
      <text
        transform={`rotate(${-feature.rotation})`}
        y={-(Math.max(feature.height / 2, 0) + 30 / scale)}
        textAnchor="middle"
        fontSize={13 / scale}
        fontWeight={700}
        fill={colors.selection}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {feature.width} × {feature.height}
      </text>
    </g>
  )
}

/**
 * The design floor.
 * - One finger on empty floor pans; two fingers pinch-zoom (mouse wheel zooms on desktop).
 * - Tap selects. Drag something already selected to move it (and everything selected with it).
 * - Hold on a table to start selecting many. Hold on empty floor, then drag, to select an area.
 */
function EditorCanvas(props: EditorCanvasProps) {
  const { layout, selection, multiIds, pickedIds, hiddenSectionId, onTap, onLongPress, onBoxSelect, onMove, onResize, topLeft, centerRef } = props
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [userView, setUserView] = useState<View | null>(null) // null = fit the whole floor
  // While dragging: how far the selected things have moved (floor units).
  const [drag, setDrag] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  // While stretching: the room item's new center and size.
  const [resize, setResize] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const pressTimer = useRef<number | null>(null)
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

  // Stop a pending long press if the screen closes mid-press.
  useEffect(
    () => () => {
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    },
    [],
  )

  // When the floor is resized, show the whole new floor (React's "reset state when a value changes" pattern).
  const floorKey = `${layout.width}x${layout.height}`
  const [shownFloor, setShownFloor] = useState(floorKey)
  // The area the "whole layout" view zooms to: measured when the editor opens, on ⤢, and when the floor is
  // resized — not on every edit, so the view doesn't jump while you're moving things.
  const [fitBox, setFitBox] = useState(() => contentBox(layout))
  if (shownFloor !== floorKey) {
    setShownFloor(floorKey)
    setUserView(null)
    setFitBox(contentBox(layout))
  }

  const fit = useMemo(() => fitView(size.width, size.height, fitBox), [size, fitBox])
  const view = userView ?? fit
  // Can always zoom out far enough to see the entire floor, even though the fit view zooms to the tables.
  const minScale = Math.min(fit.scale, Math.min(size.width / layout.width, size.height / layout.height)) * 0.8
  const maxScale = Math.max(fit.scale * 10, 40)

  // Tell the editor which floor point is in the middle of the screen.
  useEffect(() => {
    centerRef.current = { x: (size.width / 2 - view.x) / view.scale, y: (size.height / 2 - view.y) / view.scale }
  }, [centerRef, size, view])

  // Mouse wheel / trackpad zoom. Added by hand because React's wheel listener can't preventDefault.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.002)
      setUserView((prev) => zoomAt(prev ?? fit, factor, e.clientX - rect.left, e.clientY - rect.top, minScale, maxScale))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fit, minScale, maxScale])

  function cancelPressTimer() {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  function localPoint(e: PointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const toFloor = (p: Point, v: View) => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale })

  /** Starting positions of everything that should move when this item is dragged (empty = not draggable now). */
  function dragGroup(target: CanvasTarget | null): Move[] {
    if (!target || target.kind === 'section' || pickedIds) return []
    let ids: string[] = []
    if (multiIds?.has(target.id)) ids = [...multiIds]
    else if (!multiIds && selection?.kind === target.kind && selection.id === target.id) ids = [target.id]
    const all = [...layout.tables, ...layout.features]
    return all.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, x: i.x, y: i.y }))
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const first = pointers.current.size === 0
    pointers.current.set(e.pointerId, localPoint(e))
    const points = [...pointers.current.values()]
    cancelPressTimer()

    if (!first) {
      // Second finger: switch to pinch zoom and drop any drag or box.
      setDrag(null)
      setBox(null)
      setResize(null)
      gesture.current = { view, points, moved: true, longPressed: false, target: null, dragging: null, boxStart: null, resizing: null }
      return
    }

    // A stretch handle on the selected room item wins over everything else.
    const handle = pickedIds ? null : handleAt(e.target)
    if (handle) {
      gesture.current = { view, points, moved: false, longPressed: false, target: null, dragging: null, boxStart: null, resizing: handle }
      return
    }

    const target = targetAt(e.target)
    const items = dragGroup(target)
    const start = toFloor(points[0], view)
    gesture.current = {
      view,
      points,
      moved: false,
      longPressed: false,
      target,
      dragging: items.length > 0 ? { startX: start.x, startY: start.y, items } : null,
      boxStart: null,
      resizing: null,
    }

    // Long press: on a table/item it starts many-select; on empty floor it starts an area box.
    if (!pickedIds && target?.kind !== 'section') {
      pressTimer.current = window.setTimeout(() => {
        const g = gesture.current
        if (!g || g.moved) return
        navigator.vibrate?.(15) // a little buzz where supported, so you know it worked
        if (target) {
          gesture.current = { ...g, longPressed: true, dragging: null }
          onLongPress(target)
        } else {
          gesture.current = { ...g, longPressed: true, boxStart: start }
          setBox(boxFrom(start, start))
        }
      }, LONG_PRESS_MS)
    }
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
      cancelPressTimer()
      if (!g.moved) gesture.current = { ...g, moved: true }
      const p = toFloor(points[0], view)

      if (g.resizing) {
        const handle = g.resizing
        const f = layout.features.find((i) => i.id === handle.id)
        if (f) setResize({ id: f.id, ...stretch(f, handle, p, layout, 44 / view.scale) })
      } else if (g.boxStart) {
        setBox(boxFrom(g.boxStart, p))
      } else if (g.dragging) {
        // Keep the whole group on the floor.
        const xs = g.dragging.items.map((i) => i.x)
        const ys = g.dragging.items.map((i) => i.y)
        const mx = clamp(snap(p.x - g.dragging.startX), 1 - Math.min(...xs), layout.width - 1 - Math.max(...xs))
        const my = clamp(snap(p.y - g.dragging.startY), 1 - Math.min(...ys), layout.height - 1 - Math.max(...ys))
        setDrag({ ids: new Set(g.dragging.items.map((i) => i.id)), dx: mx, dy: my })
      } else if (!g.longPressed) {
        setUserView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
      }
    } else if (points.length >= 2 && g.points.length >= 2) {
      const startMid = midpoint(g.points[0], g.points[1])
      const mid = midpoint(points[0], points[1])
      const factor = distance(points[0], points[1]) / (distance(g.points[0], g.points[1]) || 1)
      const scale = clamp(g.view.scale * factor, minScale, maxScale)
      // The floor point that was under the fingers' midpoint stays under it.
      const world = toFloor(startMid, g.view)
      setUserView({ scale, x: mid.x - world.x * scale, y: mid.y - world.y * scale })
    }
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    cancelPressTimer()
    const g = gesture.current
    const single = pointers.current.size === 1
    pointers.current.delete(e.pointerId)

    if (g && single && e.type === 'pointerup') {
      if (g.resizing && resize) {
        onResize(resize.id, { x: resize.x, y: resize.y, width: resize.width, height: resize.height })
      } else if (g.boxStart && box) {
        const inside = (p: { x: number; y: number }) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY
        onBoxSelect([...layout.tables, ...layout.features].filter(inside).map((i) => i.id))
      } else if (g.dragging && drag) {
        onMove(g.dragging.items.map((i) => ({ id: i.id, x: i.x + drag.dx, y: i.y + drag.dy })))
      } else if (!g.moved && !g.longPressed) {
        onTap(g.target)
      }
    }
    setDrag(null)
    setBox(null)
    setResize(null)

    if (pointers.current.size > 0) {
      gesture.current = { view, points: [...pointers.current.values()], moved: true, longPressed: false, target: null, dragging: null, boxStart: null, resizing: null }
    } else gesture.current = null
  }

  const zoomButtons = (factor: number) => setUserView(zoomAt(view, factor, size.width / 2, size.height / 2, minScale, maxScale))

  const live = <T extends { id: string; x: number; y: number }>(item: T): T =>
    drag?.ids.has(item.id) ? { ...item, x: item.x + drag.dx, y: item.y + drag.dy } : item
  const tables = layout.tables.map(live)
  const zoomedIn = view.scale >= SHOW_CHAIRS_SCALE
  const isSelected = (kind: CanvasTarget['kind'], id: string) =>
    multiIds ? multiIds.has(id) : selection?.kind === kind && selection.id === id

  const gridLines = []
  for (let x = GRID; x < layout.width; x += GRID) gridLines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={layout.height} />)
  for (let y = GRID; y < layout.height; y += GRID) gridLines.push(<line key={`y${y}`} x1={0} y1={y} x2={layout.width} y2={y} />)

  const isEmpty = layout.tables.length === 0 && layout.features.length === 0
  // Names of VIP / group tables, drawn in their own layer so they never overlap each other.
  const nameOf = useCallback((t: RestaurantLayout['tables'][number]): TableName | null => {
    if (t.kind === 'regular') return null
    const text = t.guestName.trim() || (t.kind === 'vip' ? 'VIP' : '')
    if (!text) return null
    // A big group's tables share one name across their combined width.
    const groupKey = t.kind !== 'group' ? undefined : t.groupId ? `grp:${t.groupId}` : `group:${text.toLowerCase()}`
    return { text, color: TABLE_KINDS[t.kind].text, groupKey }
  }, [])
  // The one selected room item shows stretch handles (not in many-select or section picking).
  const stretchTarget =
    !multiIds && !pickedIds && selection?.kind === 'feature' && !drag ? layout.features.find((f) => f.id === selection.id) : undefined

  return (
    <div className="floor">
      <div
        className="floor__surface"
        ref={surfaceRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()} // a long press shouldn't open the browser's menu
      >
        {size.width > 0 && (
          <svg width={size.width} height={size.height} aria-label="Restaurant floor">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              <rect width={layout.width} height={layout.height} rx={1} fill={colors.ground} stroke={colors.groundStroke} strokeWidth={0.3} />
              <g stroke={colors.groundStroke} strokeWidth={Math.max(0.06, 0.6 / view.scale)}>
                {gridLines}
              </g>

              {isEmpty && (
                <text
                  x={layout.width / 2}
                  y={layout.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(2.5, 16 / view.scale)}
                  fill={colors.inkMuted}
                >
                  Blank floor — tap “+ Table” or a room item above to start
                </text>
              )}

              {showSections &&
                layout.sections
                .filter((s) => s.id !== hiddenSectionId)
                .map((s) => (
                  <SectionOutline
                    key={s.id}
                    section={s}
                    tables={tables.filter((t) => t.sectionId === s.id)}
                    selected={!multiIds && isSelected('section', s.id)}
                  />
                ))}

              {layout.features.map((f) => (
                <g key={f.id} data-item-kind="feature" data-item-id={f.id} className="editor__item" opacity={pickedIds ? 0.5 : 1}>
                  <DesignFeatureShape
                    feature={resize?.id === f.id ? { ...f, ...resize } : live(f)}
                    selected={isSelected('feature', f.id)}
                    scale={view.scale}
                  />
                </g>
              ))}

              {tables.map((t) => (
                <g key={t.id} data-item-kind="table" data-item-id={t.id} className="editor__item">
                  <DesignTableShape
                    table={t}
                    selected={isSelected('table', t.id)}
                    picked={pickedIds?.has(t.id) ?? false}
                    showChairs={zoomedIn || (!multiIds && isSelected('table', t.id))}
                    scale={view.scale}
                    hideNames
                  />
                </g>
              ))}

              {/* Section names, small, under each section; on top so the whole name always shows. */}
              {showSections && (
                <SectionLabels layout={layout} scale={view.scale} hiddenIds={hiddenSectionId ? new Set([hiddenSectionId]) : undefined} />
              )}

              {/* VIP / group names: middle of the table, or just above / below if another name is in the way. */}
              <TableNameLabels tables={tables} nameOf={nameOf} scale={view.scale} zoomedIn={zoomedIn} />

              {stretchTarget && (
                <StretchHandles feature={resize?.id === stretchTarget.id ? { ...stretchTarget, ...resize } : stretchTarget} scale={view.scale} />
              )}

              {box && (
                <rect
                  x={box.minX}
                  y={box.minY}
                  width={box.maxX - box.minX}
                  height={box.maxY - box.minY}
                  fill={colors.selection}
                  fillOpacity={0.12}
                  stroke={colors.selection}
                  strokeWidth={2 / view.scale}
                  strokeDasharray={`${6 / view.scale} ${4 / view.scale}`}
                  pointerEvents="none"
                />
              )}
            </g>
          </svg>
        )}
      </div>

      {topLeft && <div className="floor-tools">{topLeft}</div>}
      <ZoomControls
        onZoomIn={() => zoomButtons(1.5)}
        onZoomOut={() => zoomButtons(1 / 1.5)}
        onFit={() => {
          setFitBox(contentBox(layout))
          setUserView(null)
        }}
        sectionsOn={showSections}
        onToggleSections={layout.sections.length > 0 ? () => setShowSections((on) => !on) : undefined}
      />
    </div>
  )
}

export default EditorCanvas
