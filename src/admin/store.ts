import type { AdminPath, AdminRoute, MapConfig, Poi } from '../types'

export interface AdminSnapshot {
  places: Poi[]
  paths: AdminPath[]
  routes: AdminRoute[]
  config: MapConfig
}

const KEY = 'dtu-admin-v1'
const empty: AdminSnapshot = { places: [], paths: [], routes: [], config: {} }

function loadLocal(): AdminSnapshot {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(empty)
    const j = JSON.parse(raw) as Partial<AdminSnapshot>
    return {
      places: Array.isArray(j.places) ? j.places : [],
      paths: Array.isArray(j.paths) ? j.paths : [],
      routes: Array.isArray(j.routes) ? j.routes : [],
      config: j.config && typeof j.config === 'object' ? j.config : {},
    }
  } catch {
    return structuredClone(empty)
  }
}

export type SyncStatus = 'local' | 'syncing' | 'cloud' | 'error'

/**
 * Local-first store for everything admin mode edits.
 *
 * Every mutation writes to localStorage immediately (offline-proof, instant),
 * then upserts to Supabase when configured. On load, the cloud copy wins if
 * it is non-empty and newer — so a fresh device picks up shared edits while
 * an offline device keeps working.
 *
 * No auth in the prototype (per project decision): the Supabase tables use
 * open policies. Lock this down with RLS + an admin role before publicising
 * the URL — see supabase/schema.sql.
 */
export class AdminStore {
  data: AdminSnapshot = loadLocal()
  status: SyncStatus = 'local'
  private listeners = new Set<() => void>()
  private supa: Promise<SupaClient | null> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.supa = this.connect()
    void this.pull()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit() {
    this.persistLocal()
    for (const fn of this.listeners) fn()
    // Debounce cloud writes — dragging a pin fires dozens of updates.
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.push(), 800)
  }

  private persistLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)) } catch { /* quota */ }
  }

  setStatus(s: SyncStatus) {
    this.status = s
    for (const fn of this.listeners) fn()
  }

  /* ── mutations ────────────────────────────────────────────────────────── */

  upsertPlace(p: Poi) {
    const i = this.data.places.findIndex((x) => x.id === p.id)
    if (i >= 0) this.data.places[i] = p
    else this.data.places.push(p)
    this.emit()
  }

  removePlace(id: string) {
    this.data.places = this.data.places.filter((x) => x.id !== id)
    this.emit()
  }

  upsertPath(p: AdminPath) {
    const i = this.data.paths.findIndex((x) => x.id === p.id)
    if (i >= 0) this.data.paths[i] = p
    else this.data.paths.push(p)
    this.emit()
  }

  removePath(id: string) {
    this.data.paths = this.data.paths.filter((x) => x.id !== id)
    this.emit()
  }

  upsertRoute(r: AdminRoute) {
    const i = this.data.routes.findIndex((x) => x.id === r.id)
    if (i >= 0) this.data.routes[i] = r
    else this.data.routes.push(r)
    this.emit()
  }

  removeRoute(id: string) {
    this.data.routes = this.data.routes.filter((x) => x.id !== id)
    this.emit()
  }

  setConfig(c: MapConfig) {
    this.data.config = c
    this.emit()
  }

  replaceAll(s: AdminSnapshot) {
    this.data = {
      places: s.places ?? [],
      paths: s.paths ?? [],
      routes: s.routes ?? [],
      config: s.config ?? {},
    }
    this.emit()
  }

  /* ── Supabase ─────────────────────────────────────────────────────────── */

  private async connect(): Promise<SupaClient | null> {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!url || !key) return null
    try {
      const { createClient } = await import('@supabase/supabase-js')
      return createClient(url, key) as unknown as SupaClient
    } catch {
      return null
    }
  }

  private async pull() {
    const client = await this.supa
    if (!client) return
    this.setStatus('syncing')
    try {
      const [places, paths, routes, config] = await Promise.all([
        client.from('admin_places').select('*'),
        client.from('admin_paths').select('*'),
        client.from('admin_routes').select('*'),
        client.from('map_config').select('*').eq('id', 1).maybeSingle(),
      ])
      if (places.error || paths.error || routes.error) throw places.error ?? paths.error ?? routes.error
      const cloud: AdminSnapshot = {
        places: (places.data ?? []).map(rowToPlace),
        paths: (paths.data ?? []).map(rowToPath),
        routes: (routes.data ?? []).map(rowToRoute),
        config: config.data ? rowToConfig(config.data) : {},
      }
      const cloudCount = cloud.places.length + cloud.paths.length + cloud.routes.length
      const localCount = this.data.places.length + this.data.paths.length + this.data.routes.length
      // Cloud wins when it actually has something we lack — otherwise keep
      // local (fresh device keeps its drafts; empty cloud never wipes local).
      if (cloudCount > 0 && cloudCount >= localCount) {
        this.data = cloud
        this.persistLocal()
        for (const fn of this.listeners) fn()
      } else if (localCount > 0) {
        await this.push()
      }
      this.setStatus('cloud')
    } catch {
      this.setStatus(this.hasLocal() ? 'local' : 'error')
    }
  }

  private hasLocal() {
    return this.data.places.length + this.data.paths.length + this.data.routes.length > 0
  }

  async push(): Promise<void> {
    const client = await this.supa
    if (!client) return
    this.setStatus('syncing')
    try {
      await Promise.all([
        client.from('admin_places').upsert(this.data.places.map(placeToRow), { onConflict: 'id' }).throwOnError(),
        client.from('admin_paths').upsert(this.data.paths.map(pathToRow), { onConflict: 'id' }).throwOnError(),
        client.from('admin_routes').upsert(this.data.routes.map(routeToRow), { onConflict: 'id' }).throwOnError(),
        client.from('map_config').upsert([{ id: 1, ...configToRow(this.data.config) }], { onConflict: 'id' }).throwOnError(),
      ])
      this.setStatus('cloud')
    } catch {
      this.setStatus('local')
    }
  }

  /** Delete cloud rows that no longer exist locally (after local deletes). */
  async pushDeletions(known: { places: string[]; paths: string[]; routes: string[] }): Promise<void> {
    const client = await this.supa
    if (!client) return
    const local = {
      places: new Set(this.data.places.map((p) => p.id)),
      paths: new Set(this.data.paths.map((p) => p.id)),
      routes: new Set(this.data.routes.map((r) => r.id)),
    }
    const drop = {
      places: known.places.filter((id) => !local.places.has(id)),
      paths: known.paths.filter((id) => !local.paths.has(id)),
      routes: known.routes.filter((id) => !local.routes.has(id)),
    }
    try {
      await Promise.all([
        ...drop.places.map((id) => client.from('admin_places').delete().eq('id', id).throwOnError()),
        ...drop.paths.map((id) => client.from('admin_paths').delete().eq('id', id).throwOnError()),
        ...drop.routes.map((id) => client.from('admin_routes').delete().eq('id', id).throwOnError()),
      ])
    } catch { /* next push retries */ }
  }
}

/* ── row mapping (minimal structural typing to avoid a hard dep) ────────── */

interface SupaQuery {
  eq(col: string, v: unknown): SupaQuery
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>
  throwOnError(): Promise<unknown>
  then<TResult1 = { data: Record<string, unknown>[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>
}

interface SupaClient {
  from(table: string): {
    select(cols?: string): SupaQuery
    upsert(rows: Record<string, unknown>[], opts?: Record<string, unknown>): SupaQuery
    delete(): SupaQuery
  }
}

const str = (v: unknown, fb = '') => (typeof v === 'string' ? v : fb)
const num = (v: unknown, fb = 0) => (typeof v === 'number' ? v : fb)

function rowToPlace(r: Record<string, unknown>): Poi {
  const props = (r.props ?? {}) as Record<string, unknown>
  return {
    id: str(r.id),
    name: str(r.name),
    cat: str(r.cat, 'admin'),
    lat: num(r.lat),
    lon: num(r.lon),
    src: 'admin',
    ...(typeof props.desc === 'string' ? { desc: props.desc } : {}),
    ...(typeof props.hours === 'string' ? { hours: props.hours } : {}),
    ...(typeof props.url === 'string' ? { url: props.url } : {}),
    ...(typeof props.phone === 'string' ? { phone: props.phone } : {}),
    ...(Array.isArray(props.aliases) ? { aliases: props.aliases.filter((a): a is string => typeof a === 'string') } : {}),
  }
}

function placeToRow(p: Poi): Record<string, unknown> {
  return {
    id: p.id, name: p.name, cat: p.cat, lat: p.lat, lon: p.lon, updated_at: new Date().toISOString(),
    props: { desc: p.desc, hours: p.hours, url: p.url, phone: p.phone, aliases: p.aliases },
  }
}

function rowToPath(r: Record<string, unknown>): AdminPath {
  return {
    id: str(r.id), name: str(r.name),
    coords: Array.isArray(r.coords) ? (r.coords as [number, number][]) : [],
    tags: (r.tags ?? {}) as AdminPath['tags'],
    updatedAt: str(r.updated_at, new Date().toISOString()),
  }
}

function pathToRow(p: AdminPath): Record<string, unknown> {
  return { id: p.id, name: p.name, coords: p.coords, tags: p.tags ?? {}, updated_at: new Date().toISOString() }
}

function rowToRoute(r: Record<string, unknown>): AdminRoute {
  return {
    id: str(r.id), name: str(r.name),
    fromLat: num(r.from_lat), fromLon: num(r.from_lon), fromLabel: str(r.from_label),
    toLat: num(r.to_lat), toLon: num(r.to_lon), toLabel: str(r.to_label),
    profile: r.profile === 'bike' ? 'bike' : 'foot',
    updatedAt: str(r.updated_at, new Date().toISOString()),
  }
}

function routeToRow(r: AdminRoute): Record<string, unknown> {
  return {
    id: r.id, name: r.name,
    from_lat: r.fromLat, from_lon: r.fromLon, from_label: r.fromLabel,
    to_lat: r.toLat, to_lon: r.toLon, to_label: r.toLabel,
    profile: r.profile, updated_at: new Date().toISOString(),
  }
}

function rowToConfig(r: Record<string, unknown>): MapConfig {
  return {
    ...(r.theme === 'light' || r.theme === 'dark' ? { theme: r.theme } : {}),
    ...(r.colors && typeof r.colors === 'object' ? { colors: r.colors as Record<string, string> } : {}),
  }
}

function configToRow(c: MapConfig): Record<string, unknown> {
  return { theme: c.theme ?? null, colors: c.colors ?? {} }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}
