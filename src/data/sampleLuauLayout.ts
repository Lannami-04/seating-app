// The sample Hawaii luau floor plan (61 tables, 8 sections, stage, bar and buffet), as a
// RestaurantLayout. "Load sample luau layout" on the home menu saves a copy of it to the database.
// The tables are written compactly per section; sampleLuauLayout() turns them into full tables.

import type { ChairKind, DesignFeature, DesignSection, DesignTable, RestaurantLayout, TableShape } from '../types'
import { SECTION_COLORS } from '../logic/designTables'

interface TableSpec {
  seats: number
  shape: TableShape
  x: number
  y: number
}

interface SectionSpec {
  id: string
  name: string
  /** Letter used for table names in this section, e.g. "P" -> P1, P2... */
  prefix: string
  tables: TableSpec[]
}

const round = (seats: number, x: number, y: number): TableSpec => ({ seats, shape: 'circle', x, y })
const square = (seats: number, x: number, y: number): TableSpec => ({ seats, shape: 'square', x, y })
const rect = (seats: number, x: number, y: number): TableSpec => ({ seats, shape: 'rectangle', x, y })

/** Makes one table spec for every (x, y) combination. */
function grid(make: (x: number, y: number) => TableSpec, xs: number[], ys: number[]): TableSpec[] {
  return ys.flatMap((y) => xs.map((x) => make(x, y)))
}

const sectionSpecs: SectionSpec[] = [
  {
    id: 'alii',
    name: 'Aliʻi (VIP)',
    prefix: 'A',
    tables: [...grid((x, y) => round(10, x, y), [64, 78, 92, 106], [24]), rect(14, 72, 35), rect(14, 98, 35)],
  },
  { id: 'plumeria', name: 'Plumeria', prefix: 'P', tables: grid((x, y) => round(10, x, y), [10, 24, 38], [24, 38, 52, 66]) },
  { id: 'hibiscus', name: 'Hibiscus', prefix: 'H', tables: grid((x, y) => round(10, x, y), [132, 146, 160], [24, 38, 52, 66]) },
  { id: 'ohana', name: 'ʻOhana', prefix: 'O', tables: grid((x, y) => round(12, x, y), [67, 85, 103], [52, 67]) },
  { id: 'moana', name: 'Moana', prefix: 'M', tables: [rect(14, 72, 82), rect(14, 98, 82)] },
  { id: 'keiki', name: 'Keiki', prefix: 'K', tables: grid((x, y) => round(8, x, y), [8, 19, 30, 41, 52], [84]) },
  { id: 'lanai', name: 'Lānai', prefix: 'L', tables: grid((x, y) => rect(6, x, y), [124, 136, 148, 160], [82, 94]) },
  {
    id: 'bar',
    name: 'Bar Side',
    prefix: 'B',
    tables: [...grid((x, y) => square(4, x, y), [8, 18, 28, 38, 48, 58], [98]), ...grid((x, y) => square(2, x, y), [72, 80, 88, 96], [96])],
  },
]

/** Wheelchair-accessible seats (by seat number) and extra highchairs, keyed by table name. */
const extras: Record<string, { wheelchair?: number[]; highchairs?: number }> = {
  A1: { wheelchair: [1, 2] },
  P1: { wheelchair: [1] },
  H1: { wheelchair: [1] },
  O1: { wheelchair: [1] },
  O4: { highchairs: 1 },
  L1: { wheelchair: [1] },
  K1: { highchairs: 2 },
  K3: { highchairs: 1 },
  K5: { highchairs: 1 },
}

/** The original plan was 170 x 110; the app's floor is at least 200 x 125, so everything moves to the middle. */
const SHIFT_X = 15
const SHIFT_Y = 8

/** A fresh copy of the sample layout with a new id (so it can be loaded more than once). */
export function sampleLuauLayout(): RestaurantLayout {
  const now = Date.now()
  const sections: DesignSection[] = sectionSpecs.map((s, i) => ({ id: s.id, name: s.name, color: SECTION_COLORS[i % SECTION_COLORS.length] }))
  const tables: DesignTable[] = []
  let tableNumber = 1
  for (const spec of sectionSpecs) {
    spec.tables.forEach((t, index) => {
      const name = `${spec.prefix}${index + 1}`
      const extra = extras[name] ?? {}
      const chairKinds: ChairKind[] = Array.from({ length: t.seats }, (_, i) => (extra.wheelchair?.includes(i + 1) ? 'wheelchair' : 'standard'))
      tables.push({
        id: `T${tableNumber++}`,
        name,
        shape: t.shape,
        kind: 'regular',
        guestName: '',
        x: t.x + SHIFT_X,
        y: t.y + SHIFT_Y,
        rotation: 0,
        seats: t.seats,
        chairKinds,
        highchairs: extra.highchairs ?? 0,
        sectionId: spec.id,
      })
    })
  }
  // Room items are stored by their center.
  const features: DesignFeature[] = [
    { id: 'stage', kind: 'stage', label: 'Stage', x: 60 + 25 + SHIFT_X, y: 2 + 5 + SHIFT_Y, width: 50, height: 10, rotation: 0 },
    { id: 'bar', kind: 'bar', label: 'Bar', x: 70 + 15 + SHIFT_X, y: 101 + 2.5 + SHIFT_Y, width: 30, height: 5, rotation: 0 },
    { id: 'buffet', kind: 'buffet', label: 'Buffet', x: 118 + 24 + SHIFT_X, y: 101 + 2.5 + SHIFT_Y, width: 48, height: 5, rotation: 0 },
  ]
  return {
    id: crypto.randomUUID(),
    name: 'Sunset Luau (sample)',
    width: 200,
    height: 125,
    tables,
    features,
    sections,
    createdAt: now,
    updatedAt: now,
  }
}
