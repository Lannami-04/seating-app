// Helpers for restaurant layouts: upgrading old data, layout files (save / open), and reading
// layouts that older versions of the app kept only in this browser. Layouts themselves are now
// stored in the database (see remote.ts and useRestaurantLayouts.ts).

import type { DesignSection, DesignTable, RestaurantLayout } from '../types'
import { looksLikeAny, unusedSectionColor } from '../logic/designTables'
import { uuid } from '../lib/uuid'

/** Where older versions of the app kept layouts in the browser (before the database). */
const STORAGE_KEY = 'seating-restaurant-layouts-v1'
const UPLOADED_KEY = 'seating-restaurant-layouts-v1-uploaded'

/** Floor size in layout units (roughly feet): room for 100+ tables in a dozen or more sections. */
const FLOOR_WIDTH = 200
const FLOOR_HEIGHT = 125

/**
 * Sections whose colors are the same or look alike: the first keeps its color,
 * later ones get the color least like all the others. Returns the same array if nothing changed.
 */
function uniqueSectionColors(sections: DesignSection[]): DesignSection[] {
  const kept: string[] = []
  let changed = false
  const result = sections.map((s) => {
    const color = looksLikeAny(s.color, kept) ? unusedSectionColor([...kept, ...sections.map((o) => o.color)]) : s.color
    kept.push(color)
    if (color === s.color) return s
    changed = true
    return { ...s, color }
  })
  return changed ? result : sections
}

/** Same layout, but with every section in a color that looks different from the others. */
export function withDistinctSectionColors(layout: RestaurantLayout): RestaurantLayout {
  const sections = uniqueSectionColors(layout.sections)
  return sections === layout.sections ? layout : { ...layout, sections }
}

/**
 * Fills in fields added after a layout was first saved (rotation, sections, features...),
 * so layouts made with an older version of the app still open.
 */
function upgradeLayout(raw: Partial<RestaurantLayout>): RestaurantLayout {
  const now = Date.now()
  return {
    id: raw.id ?? `L${now.toString(36)}`,
    name: raw.name ?? 'Untitled',
    // Older layouts used a small 80x50 floor; grow them so there's room for more tables.
    width: Math.max(raw.width ?? 0, FLOOR_WIDTH),
    height: Math.max(raw.height ?? 0, FLOOR_HEIGHT),
    tables: (raw.tables ?? []).map(
      (t: Partial<DesignTable>) =>
        ({
          ...t,
          kind: t.kind ?? 'regular',
          guestName: t.guestName ?? '',
          rotation: t.rotation ?? 0,
          // Highchairs used to replace a seat; now they're extra spots. Move any old ones over.
          chairKinds: (t.chairKinds ?? []).map((k) => (k === 'highchair' ? 'standard' : k)),
          highchairs: t.highchairs ?? (t.chairKinds ?? []).filter((k) => k === 'highchair').length,
          sectionId: t.sectionId ?? null,
        }) as DesignTable,
    ),
    features: raw.features ?? [],
    sections: uniqueSectionColors(raw.sections ?? []),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

/** Layouts saved in this browser by the app before it used the database ([] if none or already copied). */
export function loadLocalLayouts(): RestaurantLayout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((l: Partial<RestaurantLayout>) => upgradeLayout(l)) : []
  } catch {
    return []
  }
}

/** After copying them to the database: keep a backup under another key, so the offer to copy goes away. */
export function markLocalLayoutsUploaded(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) localStorage.setItem(UPLOADED_KEY, raw)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to do.
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The database needs layout ids in UUID form. Layouts made by older versions ("L…" ids) get a new
 * id; layouts that already have one keep it, so opening the same file again replaces them.
 */
export function withDatabaseId(layout: RestaurantLayout): RestaurantLayout {
  return UUID.test(layout.id) ? layout : { ...layout, id: uuid() }
}

/** Downloads the layouts as a file the user can keep as a backup or open on another device. */
export function downloadLayoutsFile(layouts: RestaurantLayout[]): void {
  const file = JSON.stringify({ app: 'seating-app', version: 1, layouts }, null, 2)
  const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `seating-layouts-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Reads a file made by downloadLayoutsFile. Throws if it isn't one. */
export function parseLayoutsFile(text: string): RestaurantLayout[] {
  const parsed: unknown = JSON.parse(text)
  const list = Array.isArray(parsed) ? parsed : (parsed as { layouts?: unknown })?.layouts
  if (!Array.isArray(list) || list.some((l) => typeof l !== 'object' || l === null || !Array.isArray(l.tables))) {
    throw new Error('Not a layouts file')
  }
  return list.map((l: Partial<RestaurantLayout>) => upgradeLayout(l))
}

/** A brand-new, empty layout: just a blank canvas with a name. */
export function createLayout(name: string): RestaurantLayout {
  const now = Date.now()
  return {
    id: uuid(),
    name,
    width: FLOOR_WIDTH,
    height: FLOOR_HEIGHT,
    tables: [],
    features: [],
    sections: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * After an event: every VIP / big group table becomes a plain regular table and loses its name.
 * Seats, wheelchair spots, highchairs, sections and positions are kept.
 */
export function withAllTablesRegular(layout: RestaurantLayout): RestaurantLayout {
  return touchLayout({
    ...layout,
    tables: layout.tables.map((t) =>
      t.kind === 'regular' && !t.guestName && !t.groupId ? t : { ...t, kind: 'regular', guestName: '', groupId: null },
    ),
  })
}

/** Same layout with its "last edited" time set to now (used to sort the home menu). */
export function touchLayout(layout: RestaurantLayout): RestaurantLayout {
  return { ...layout, updatedAt: Date.now() }
}
