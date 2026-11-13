// Undo / redo for the layout editor. Plain functions, no React: easy to follow and to test.
// The history keeps whole copies of the layout ("snapshots"). Layouts are small, so this is simple and safe.

import type { RestaurantLayout } from '../types'

export interface UndoHistory {
  /** Earlier versions, oldest first. Undo goes back to the last one. */
  past: RestaurantLayout[]
  /** Versions you undid, nearest first. Redo goes forward to the first one. */
  future: RestaurantLayout[]
  /** What the last change was (e.g. "typing the name of table T3"), so typing counts as one step. */
  lastKey: string | null
  lastTime: number
}

/** How many steps back you can go. */
const MAX_STEPS = 100
/** Changes of the same kind closer together than this become one undo step (typing, dragging the angle slider). */
const MERGE_MS = 1500

export const emptyHistory: UndoHistory = { past: [], future: [], lastKey: null, lastTime: 0 }

/**
 * Records that `before` is about to be replaced by a new version.
 * Any redo steps are dropped, because a new change starts a new path.
 */
export function recordChange(h: UndoHistory, before: RestaurantLayout, mergeKey: string | null, now: number): UndoHistory {
  const merge = mergeKey !== null && mergeKey === h.lastKey && now - h.lastTime < MERGE_MS
  return {
    past: merge ? h.past : [...h.past, before].slice(-MAX_STEPS),
    future: [],
    lastKey: mergeKey,
    lastTime: now,
  }
}

/** Steps back. Returns the layout to show and the new history, or null if there's nothing to undo. */
export function undo(h: UndoHistory, current: RestaurantLayout): { layout: RestaurantLayout; history: UndoHistory } | null {
  const previous = h.past[h.past.length - 1]
  if (!previous) return null
  return {
    layout: previous,
    history: { past: h.past.slice(0, -1), future: [current, ...h.future], lastKey: null, lastTime: 0 },
  }
}

/** Steps forward again. Returns null if there's nothing to redo. */
export function redo(h: UndoHistory, current: RestaurantLayout): { layout: RestaurantLayout; history: UndoHistory } | null {
  const next = h.future[0]
  if (!next) return null
  return {
    layout: next,
    history: { past: [...h.past, current], future: h.future.slice(1), lastKey: null, lastTime: 0 },
  }
}

/** Current time in ms (kept out of components so React's purity checks stay happy). */
export function nowMs(): number {
  return Date.now()
}
