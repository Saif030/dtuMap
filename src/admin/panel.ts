import type maplibregl from 'maplibre-gl'
import type { AdminPath, AdminRoute, Campus, Poi, Profile } from '../types'
import { AdminStore, newId, type SyncStatus } from './store'
import './admin.css'

export interface AdminCtx {
  map: maplibregl.Map
  campus: Campus
  /** All admin places (live array from the store). */
  adminPois: () => Poi[]
  /** Full POI list including admin places, for selects. */
  allPois: () => Poi[]
  /** Rebuild search index + POI layer + router after a data change. */
  refreshAll: () => void
  routeTo: (lat: number, lon: number, label: string) => void
  focusPoi: (p: Poi) => void
  catColor: (cat: string) => string
  setCatColor: (cat: string | null, color?: string) => void
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

type Mode = 'off' | 'place' | 'move' | 'path' | 'routes' | 'custom'

/**
 * Admin mode — no-auth prototype. Toggle with the ✎ button or ?admin=1.
 *
 * - place: click the map to drop a pin, fill the form, done.
 * - move: pick an admin pin, then click its new spot.
 * - path: click-click-click to draw, Done to save. Saved paths join the
 *   routing graph (via mergeGraph) so shortcuts route immediately.
 * - routes: named A→B shortcuts resolved live through the router.
 * - custom: theme default + per-category colours, map-wide.
 *
 * Everything persists to AdminStore (localStorage now, Supabase when set).
 */
export function initAdmin(ctx: AdminCtx, store: AdminStore) {
  const { map } = ctx
  let mode: Mode = 'off'
  let draft: [number, number][] = []
  let moveId: string | null = null
  let editingId: string | null = null

  /* ── chrome ─────────────────────────────────────────────────────────── */

  const bar = document.createElement('div')
  bar.id = 'admin-bar'
  bar.hidden = true
  document.body.append(bar)

  const panel = document.createElement('div')
  panel.id = 'admin-panel'
  panel.hidden = true
  document.body.append(panel)

  // Intercept right-click/long-press reports: in admin mode they open the
  // place editor at that point instead of the OSM editor.
  const reportHook = (window as unknown as { __dtuReport?: (fn: (lat: number, lon: number) => boolean) => void })
    .__dtuReport
  reportHook?.((lat, lon) => {
    if (mode === 'off') return false
    startPlaceForm(lon, lat)
    return true
  })

  const syncDot = (s: SyncStatus) =>
    s === 'cloud' ? '<span class="sync ok" title="Synced to shared database">● cloud</span>'
    : s === 'syncing' ? '<span class="sync busy" title="Syncing…">● …</span>'
    : s === 'error' ? '<span class="sync err" title="Nothing saved yet and cloud unreachable">● offline</span>'
    : '<span class="sync" title="Saved on this device only — set Supabase keys to share">● local</span>'

  function paintBar() {
    const n = store.data.places.length + store.data.paths.length + store.data.routes.length
    bar.innerHTML = `
      <span class="a-title">admin${n ? ` · ${n}` : ''}</span>
      ${syncDot(store.status)}
      <button data-m="place" class="${mode === 'place' ? 'on' : ''}" title="Add a place — click the map">+ place</button>
      <button data-m="path" class="${mode === 'path' ? 'on' : ''}" title="Draw a path — click for each corner">〜 path</button>
      <button data-m="routes" class="${mode === 'routes' ? 'on' : ''}" title="Saved A→B routes">⇄ routes</button>
      <button data-m="custom" class="${mode === 'custom' ? 'on' : ''}" title="Theme + category colours">🎨 map</button>
      <button data-m="export" title="Download / import JSON">⇅</button>
      <button data-m="close" title="Exit admin mode">✕</button>`
  }

  function setMode(m: Mode) {
    mode = m
    draft = []
    moveId = null
    map.getCanvas().style.cursor = m === 'place' || m === 'path' ? 'crosshair' : ''
    drawDraft()
    paintBar()
    paintPanel()
  }

  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (!b) return
    const m = b.dataset.m as Mode | 'close' | 'export'
    if (m === 'close') { setEnabled(false); return }
    if (m === 'export') { setMode('off'); showExport(); bar.hidden = false; return }
    setMode(mode === m ? 'off' : (m as Mode))
  })

  /* ── map layers ─────────────────────────────────────────────────────── */

  function ensureLayers() {
    const style = map.getStyle()
    if (!style || map.getSource('admin-paths')) return
    map.addSource('admin-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addSource('admin-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'admin-path-line', type: 'line', source: 'admin-paths',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#58a6ff', 'line-width': 3, 'line-dasharray': [2, 1.5] },
    })
    map.addLayer({
      id: 'admin-path-label', type: 'symbol', source: 'admin-paths',
      minzoom: 14.5,
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
        'text-size': 11, 'symbol-placement': 'line', 'text-optional': true,
      },
      paint: { 'text-color': '#9aa4b2', 'text-halo-color': '#0b0d10', 'text-halo-width': 1.2 },
    })
    map.addLayer({
      id: 'admin-draft-line', type: 'line', source: 'admin-draft',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff9bce', 'line-width': 3, 'line-dasharray': [1, 1] },
    })
    map.addLayer({
      id: 'admin-draft-dot', type: 'circle', source: 'admin-draft',
      paint: { 'circle-radius': 5, 'circle-color': '#ff9bce', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
    })
  }

  function refreshAdminLayers() {
    ensureLayers()
    const paths = map.getSource('admin-paths') as maplibregl.GeoJSONSource | undefined
    paths?.setData({
      type: 'FeatureCollection',
      features: store.data.paths.map((p) => ({
        type: 'Feature' as const,
        properties: { name: p.name },
        geometry: { type: 'LineString' as const, coordinates: p.coords },
      })),
    })
  }

  function drawDraft() {
    const src = map.getSource('admin-draft') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const feats: GeoJSON.Feature[] = []
    if (draft.length >= 2) {
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft } })
    }
    for (const c of draft) {
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })
    }
    src.setData({ type: 'FeatureCollection', features: feats })
  }

  /* ── map clicks ─────────────────────────────────────────────────────── */

  map.on('click', (e) => {
    if (mode === 'off') return
    const { lng, lat } = e.lngLat
    if (mode === 'place') startPlaceForm(lng, lat)
    else if (mode === 'move' && moveId) {
      const p = store.data.places.find((x) => x.id === moveId)
      if (p) {
        store.upsertPlace({ ...p, lon: +lng.toFixed(6), lat: +lat.toFixed(6) })
        ctx.refreshAll()
      }
      moveId = null
      paintPanel()
    } else if (mode === 'path') {
      draft.push([+lng.toFixed(6), +lat.toFixed(6)])
      drawDraft()
      paintPanel()
    }
  })

  map.on('dblclick', (e) => {
    if (mode === 'path' && draft.length >= 2) { e.preventDefault(); finishPath() }
  })

  document.addEventListener('keydown', (e) => {
    if (mode === 'off') return
    if (e.key === 'Enter' && mode === 'path' && draft.length >= 2
        && (e.target as HTMLElement)?.tagName !== 'INPUT') finishPath()
    if (e.key === 'Escape') setMode('off')
  })

  // Clicking an admin pin opens its editor (admin pins render in the main poi
  // layer, so reuse the map click → feature lookup).
  for (const layer of ['poi-dot', 'poi-label', 'poi-label-minor']) {
    map.on('click', layer, (e) => {
      if (mode === 'off') return
      const id = e.features?.[0]?.properties?.id as string | undefined
      const p = id && store.data.places.find((x) => x.id === id)
      if (p) { editingId = p.id; showPlaceForm(p) }
    })
  }

  /* ── place form ─────────────────────────────────────────────────────── */

  const catOptions = () =>
    Object.entries(ctx.campus.categories)
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('')

  function startPlaceForm(lon: number, lat: number) {
    editingId = null
    showPlaceForm({
      id: newId('place'), name: '', cat: 'canteen',
      lon: +lon.toFixed(6), lat: +lat.toFixed(6), src: 'admin',
    })
  }

  function showPlaceForm(p: Poi) {
    panel.hidden = false
    panel.innerHTML = `
      <div class="a-head"><b>${editingId ? 'Edit place' : 'New place'}</b>
        <button class="x" data-x>✕</button></div>
      <label>Name<input id="a-name" value="${esc(p.name)}" placeholder="e.g. MicMac Food Court" maxlength="80"></label>
      <label>Category<select id="a-cat">${catOptions()}</select></label>
      <label>Description<input id="a-desc" value="${esc(p.desc ?? '')}" placeholder="one line on why it matters" maxlength="140"></label>
      <label>Hours<input id="a-hours" value="${esc(p.hours ?? '')}" placeholder="Mo-Sa 09:00-21:00" maxlength="60"></label>
      <div class="a-coords">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
      <div class="a-row">
        <button data-save>Save</button>
        ${editingId ? '<button data-move>Move</button><button data-del class="danger">Delete</button>' : ''}
      </div>`
    ;(panel.querySelector('#a-cat') as HTMLSelectElement).value = p.cat
    ;(panel.querySelector('#a-name') as HTMLInputElement).focus()

    panel.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
      if (!t) return
      if (t.dataset.x !== undefined) { panel.hidden = true; editingId = null; return }
      const name = (panel.querySelector('#a-name') as HTMLInputElement).value.trim()
      const cat = (panel.querySelector('#a-cat') as HTMLSelectElement).value
      const desc = (panel.querySelector('#a-desc') as HTMLInputElement).value.trim()
      const hours = (panel.querySelector('#a-hours') as HTMLInputElement).value.trim()
      if (t.dataset.save !== undefined) {
        if (!name) { (panel.querySelector('#a-name') as HTMLInputElement).focus(); return }
        store.upsertPlace({
          ...p, name, cat,
          ...(desc ? { desc } : { desc: undefined }),
          ...(hours ? { hours } : { hours: undefined }),
        })
        ctx.refreshAll()
        ctx.focusPoi({ ...p, name, cat })
        panel.hidden = true
        editingId = null
      } else if (t.dataset.move !== undefined && editingId) {
        moveId = editingId
        panel.hidden = true
        setMode('move')
        paintPanel()
      } else if (t.dataset.del !== undefined && editingId) {
        store.removePlace(editingId)
        ctx.refreshAll()
        panel.hidden = true
        editingId = null
      }
    }
  }

  /* ── path form ──────────────────────────────────────────────────────── */

  function finishPath() {
    if (draft.length < 2) return
    panel.hidden = false
    panel.innerHTML = `
      <div class="a-head"><b>Save path (${draft.length} points)</b>
        <button class="x" data-x>✕</button></div>
      <label>Name<input id="a-pname" placeholder="e.g. Library shortcut" maxlength="80"></label>
      <label class="chk"><input type="checkbox" id="a-bike" checked> Cyclable</label>
      <label class="chk"><input type="checkbox" id="a-unpaved"> Unpaved shortcut</label>
      <label class="chk"><input type="checkbox" id="a-lit"> Lit at night</label>
      <div class="a-row"><button data-save>Save path</button>
        <button data-clear class="danger">Discard</button></div>`
    panel.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
      if (!t) return
      if (t.dataset.x !== undefined || t.dataset.clear !== undefined) {
        draft = []
        drawDraft()
        panel.hidden = true
        return
      }
      if (t.dataset.save !== undefined) {
        const name = (panel.querySelector('#a-pname') as HTMLInputElement).value.trim() || 'Untitled path'
        const path: AdminPath = {
          id: newId('path'), name, coords: [...draft],
          tags: {
            bike: (panel.querySelector('#a-bike') as HTMLInputElement).checked,
            unpaved: (panel.querySelector('#a-unpaved') as HTMLInputElement).checked,
            lit: (panel.querySelector('#a-lit') as HTMLInputElement).checked,
          },
          updatedAt: new Date().toISOString(),
        }
        store.upsertPath(path)
        draft = []
        drawDraft()
        ctx.refreshAll()
        panel.hidden = true
        paintBar()
      }
    }
  }

  /* ── routes ─────────────────────────────────────────────────────────── */

  function paintPanel() {
    if (mode === 'off' || mode === 'place') {
      if (mode === 'off') panel.hidden = true
      return
    }
    panel.hidden = false
    if (mode === 'move') {
      panel.innerHTML = `<div class="a-head"><b>Move pin</b><button class="x" data-x>✕</button></div>
        <p class="a-note">Click the map where <b>${esc(store.data.places.find((p) => p.id === moveId)?.name ?? '')}</b> should sit.</p>`
      panel.onclick = (e) => {
        if ((e.target as HTMLElement).closest('button')) { panel.hidden = true; setMode('off') }
      }
      return
    }
    if (mode === 'path') {
      panel.innerHTML = `<div class="a-head"><b>Draw path</b><button class="x" data-x>✕</button></div>
        <p class="a-note">Click the map for each corner${draft.length ? ` — <b>${draft.length}</b> points` : ''}.
        Double-click, Enter or Done to finish.</p>
        <div class="a-row"><button data-done ${draft.length < 2 ? 'disabled' : ''}>Done</button>
        <button data-undo ${draft.length ? '' : 'disabled'}>Undo point</button></div>`
      panel.onclick = (e) => {
        const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
        if (!t) return
        if (t.dataset.x !== undefined) { setMode('off'); return }
        if (t.dataset.done !== undefined) finishPath()
        if (t.dataset.undo !== undefined) { draft.pop(); drawDraft(); paintPanel() }
      }
      return
    }
    if (mode === 'routes') { showRoutes(); return }
    if (mode === 'custom') { showCustom(); return }
  }

  function poiSelect(id: string): string {
    const opts = ctx.allPois().map((p) =>
      `<option value="${esc(p.id)}">${esc(p.name)} (${esc(ctx.campus.categories[p.cat]?.label ?? p.cat)})</option>`).join('')
    return `<select id="${id}">${opts}</select>`
  }

  function showRoutes() {
    const list = store.data.routes.map((r) => `
      <div class="a-route">
        <div><b>${esc(r.name)}</b><br>
          <span class="a-sub">${esc(r.fromLabel)} → ${esc(r.toLabel)} · ${r.profile}</span></div>
        <button data-show="${esc(r.id)}">Show</button>
        <button data-del="${esc(r.id)}" class="danger">✕</button>
      </div>`).join('') || '<p class="a-note">No saved routes yet.</p>'

    panel.innerHTML = `
      <div class="a-head"><b>Saved routes</b><button class="x" data-x>✕</button></div>
      <label>Name<input id="a-rname" placeholder="e.g. Gate to Library" maxlength="80"></label>
      <label>From${poiSelect('a-from')}</label>
      <label>To${poiSelect('a-to')}</label>
      <label>Profile<select id="a-prof"><option value="foot">walk</option><option value="bike">cycle</option></select></label>
      <div class="a-row"><button data-save>Save route</button></div>
      <div class="a-sec">Saved</div>${list}`

    panel.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
      if (!t) return
      if (t.dataset.x !== undefined) { setMode('off'); return }
      if (t.dataset.show !== undefined) {
        const r = store.data.routes.find((x) => x.id === t.dataset.show)
        // Resolved live through the router, which includes admin paths.
        if (r) ctx.routeTo(r.toLat, r.toLon, r.toLabel)
        return
      }
      if (t.dataset.del !== undefined) {
        store.removeRoute(t.dataset.del)
        ctx.refreshAll()
        showRoutes()
        paintBar()
        return
      }
      if (t.dataset.save !== undefined) {
        const byId = new Map(ctx.allPois().map((p) => [p.id, p]))
        const a = byId.get((panel.querySelector('#a-from') as HTMLSelectElement).value)
        const b = byId.get((panel.querySelector('#a-to') as HTMLSelectElement).value)
        const name = (panel.querySelector('#a-rname') as HTMLInputElement).value.trim()
          || (a && b ? `${a.name} → ${b.name}` : 'Untitled route')
        if (!a || !b) return
        const route: AdminRoute = {
          id: newId('route'), name,
          fromLat: a.lat, fromLon: a.lon, fromLabel: a.name,
          toLat: b.lat, toLon: b.lon, toLabel: b.name,
          profile: (panel.querySelector('#a-prof') as HTMLSelectElement).value as Profile,
          updatedAt: new Date().toISOString(),
        }
        store.upsertRoute(route)
        ctx.refreshAll()
        showRoutes()
        paintBar()
      }
    }
  }

  /* ── customise ──────────────────────────────────────────────────────── */

  function showCustom() {
    const colors = store.data.config.colors ?? {}
    const rows = Object.entries(ctx.campus.categories)
      .filter(([c]) => (ctx.campus.meta.counts[c] ?? 0) > 0 || colors[c])
      .map(([c, meta]) => `
        <div class="a-color">
          <input type="color" value="${esc(colors[c] ?? meta.color)}" data-cat="${esc(c)}">
          <span>${esc(meta.label)}</span>
          ${colors[c] ? `<button data-reset="${esc(c)}" title="Reset">↺</button>` : ''}
        </div>`).join('')

    panel.innerHTML = `
      <div class="a-head"><b>Customise map</b><button class="x" data-x>✕</button></div>
      <p class="a-note">Colours apply instantly for everyone on this device, and
      sync to the shared database when configured.</p>
      ${rows}
      <div class="a-row"><button data-resetall class="danger">Reset all colours</button></div>`

    panel.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((inp) => {
      inp.addEventListener('input', () => {
        ctx.setCatColor(inp.dataset.cat!, inp.value)
        store.setConfig({ ...store.data.config, colors: { ...(store.data.config.colors ?? {}), [inp.dataset.cat!]: inp.value } })
      })
      inp.addEventListener('change', () => { ctx.refreshAll(); showCustom() })
    })
    panel.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
      if (!t) return
      if (t.dataset.x !== undefined) { setMode('off'); return }
      if (t.dataset.reset !== undefined) {
        ctx.setCatColor(t.dataset.reset, undefined)
        const colors = { ...(store.data.config.colors ?? {}) }
        delete colors[t.dataset.reset]
        store.setConfig({ ...store.data.config, colors })
        ctx.refreshAll()
        showCustom()
      }
      if (t.dataset.resetall !== undefined) {
        ctx.setCatColor(null)
        store.setConfig({ ...store.data.config, colors: {} })
        ctx.refreshAll()
        showCustom()
      }
    }
  }

  /* ── export / import ────────────────────────────────────────────────── */

  function showExport() {
    panel.hidden = false
    panel.innerHTML = `
      <div class="a-head"><b>Export / import</b><button class="x" data-x>✕</button></div>
      <p class="a-note">${store.data.places.length} places · ${store.data.paths.length} paths · ${store.data.routes.length} routes.
      Export matches <code>data/curated/places.json</code> format for places.</p>
      <div class="a-row"><button data-dl>Download JSON</button></div>
      <label>Import JSON<input type="file" id="a-file" accept="application/json"></label>`
    panel.onclick = (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLElement | null
      if (t?.dataset.x !== undefined) { panel.hidden = true; return }
      if (t?.dataset.dl !== undefined) {
        const blob = new Blob([JSON.stringify({
          _source: 'dtumap admin export',
          _exported: new Date().toISOString().slice(0, 10),
          places: store.data.places,
          paths: store.data.paths,
          routes: store.data.routes,
          config: store.data.config,
        }, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'dtumap-admin.json'
        a.click()
        URL.revokeObjectURL(a.href)
      }
    }
    panel.querySelector('#a-file')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]
      if (!f) return
      try {
        const j = JSON.parse(await f.text()) as Partial<import('./store').AdminSnapshot & { places: Poi[] }>
        store.replaceAll({
          places: Array.isArray(j.places) ? j.places.filter((p) => p && typeof p.name === 'string') : [],
          paths: Array.isArray(j.paths) ? j.paths : [],
          routes: Array.isArray(j.routes) ? j.routes : [],
          config: j.config ?? {},
        })
        ctx.refreshAll()
        paintBar()
        panel.hidden = true
      } catch {
        panel.querySelector('.a-note')!.textContent = 'Could not read that file — is it dtumap JSON?'
      }
    })
  }

  /* ── enable / disable ───────────────────────────────────────────────── */

  function setEnabled(on: boolean) {
    bar.hidden = !on
    if (!on) {
      panel.hidden = true
      setMode('off')
      document.body.classList.remove('admin')
    } else {
      document.body.classList.add('admin')
      setMode('off')
      paintBar()
    }
    const btn = document.getElementById('admin-btn')
    btn?.classList.toggle('on', on)
    btn?.setAttribute('aria-pressed', String(on))
  }

  store.subscribe(() => {
    paintBar()
    refreshAdminLayers()
  })

  map.on('load', () => {
    refreshAdminLayers()
  })
  // Style swaps (theme toggle) drop custom sources — re-add them.
  map.on('styledata', () => {
    if (!bar.hidden) refreshAdminLayers()
  })

  const params = new URLSearchParams(location.search)
  const btn = document.getElementById('admin-btn')
  btn?.addEventListener('click', () => setEnabled(bar.hidden))
  if (params.get('admin') === '1') setEnabled(true)

  return { setEnabled, isEnabled: () => !bar.hidden }
}
