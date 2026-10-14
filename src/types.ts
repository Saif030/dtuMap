export interface Poi {
  id: string
  name: string
  cat: string
  lat: number
  lon: number
  src: 'osm' | 'seed' | 'admin'
  osm?: string
  kind?: string
  unnamed?: true
  alt?: string
  /** Extra names people actually use, e.g. "Hall 6" for Girls Hostel 6. */
  aliases?: string[]
  hours?: string
  wheelchair?: string
  phone?: string
  url?: string
  cuisine?: string
  capacity?: string
  covered?: string
  operator?: string
  desc?: string
  level?: string
  potable?: string
  lampType?: string
  support?: string
  near?: string
  price?: string
}

export interface Category {
  label: string
  color: string
  pin: boolean
}

export interface Faculty {
  name: string
  title: string
  /** Primary department — the first listing this person appeared under. */
  dept: string
  /** Every department they are listed under; 59 hold joint appointments. */
  depts: string[]
  url: string
  email?: string
  phone?: string
  web?: string
  office?: string
  research?: string
  qualification?: string
  /** Name of the OSM feature this person was placed at, if resolved. */
  at?: string
  atVia?: 'office' | 'dept'
}

export interface MessMenu {
  hall: string
  day: string
  meal: string
  menu: string
  extras?: string
  updated?: string
}

export interface MessHall {
  name: string
  type: string
  tags: string[]
  at?: string
}

export interface Campus {
  meta: {
    name: string
    built: string
    center: [number, number]
    attribution: string
    counts: Record<string, number>
  }
  categories: Record<string, Category>
  pois: Poi[]
  places?: { items: Poi[] }
  faculty?: {
    _source: string
    _fetched: string
    _note: string
    /** Departments whose listing count did not match after paging. Empty is good. */
    _incomplete_departments: { dept: string; got: number; expected: number }[]
    _located?: number
    items: Faculty[]
  }
  mess?: {
    _source: string
    _fetched: string
    _note: string
    halls: MessHall[]
    items: MessMenu[]
  }
}

export interface Graph {
  lat: number[]
  lon: number[]
  /** [a, b, metres, footSeconds, bikeSeconds, flags] */
  edges: [number, number, number, number, number, number][]
}

export type Profile = 'foot' | 'bike'

/* ── admin-editable overlays ────────────────────────────────────────────── */

/** A hand-drawn walkable/cyclable path. Vertices in [lon, lat] order. */
export interface AdminPath {
  id: string
  name: string
  coords: [number, number][]
  /** foot/bike allowed, unpaved shortcut styling, lit at night */
  tags?: { foot?: boolean; bike?: boolean; unpaved?: boolean; lit?: boolean }
  updatedAt: string
}

/** A saved named route between two points (resolved live through the router). */
export interface AdminRoute {
  id: string
  name: string
  fromLat: number
  fromLon: number
  fromLabel: string
  toLat: number
  toLon: number
  toLabel: string
  profile: Profile
  updatedAt: string
}

/** Whole-map customisation: theme default + per-category colour overrides. */
export interface MapConfig {
  theme?: 'light' | 'dark'
  colors?: Record<string, string>
}

export interface Route {
  coords: [number, number][]
  seconds: number
  metres: number
  steps: boolean
  indoor: boolean
  unpaved: boolean
}
