import type { AdminPath, Graph } from '../types'
import { metresBetween } from '../route/router'

const WALK = 1.35 // m/s — same campus walking pace as the OSM build
const BIKE = 4.2 * 0.72 // m/s — footway cycling pace, matching build-data.mjs
const FLAG_LIT = 4
const FLAG_SHORTCUT = 8

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Merge hand-drawn admin paths into a routable graph.
 *
 * Pure function of (base graph, paths) — the app rebuilds the Router from the
 * result whenever paths change, and the smoke test pins the behaviour.
 *
 * Each path vertex becomes a node; consecutive vertices become edges with the
 * same footway cost model as the OSM build. Every vertex is also stitched to
 * its nearest base node within CONNECT_M so a drawn shortcut actually joins
 * the network instead of floating beside it.
 */
export const CONNECT_M = 60

export function mergeGraph(base: Graph, paths: AdminPath[]): Graph {
  const lat = [...base.lat]
  const lon = [...base.lon]
  const edges: Graph['edges'] = base.edges.map((e) => [...e] as Graph['edges'][number])

  const keyOf = (la: number, lo: number) => `${la.toFixed(7)},${lo.toFixed(7)}`
  const index = new Map<string, number>()
  base.lat.forEach((la, i) => index.set(keyOf(la, base.lon[i]!), i))

  const getNode = (la: number, lo: number): number => {
    const k = keyOf(la, lo)
    const hit = index.get(k)
    if (hit !== undefined) return hit
    const i = lat.length
    index.set(k, i)
    lat.push(+la.toFixed(6))
    lon.push(+lo.toFixed(6))
    return i
  }

  const nearestBase = (la: number, lo: number): { i: number; m: number } => {
    let bi = -1
    let bm = Infinity
    for (let i = 0; i < base.lat.length; i++) {
      const m = metresBetween(la, lo, base.lat[i]!, base.lon[i]!)
      if (m < bm) { bm = m; bi = i }
    }
    return { i: bi, m: bm }
  }

  for (const p of paths) {
    if (p.coords.length < 2) continue
    const tags = p.tags ?? {}
    const footOk = tags.foot !== false
    const bikeOk = tags.bike !== false
    let flags = 0
    if (tags.lit) flags |= FLAG_LIT
    if (tags.unpaved) flags |= FLAG_SHORTCUT

    const nodes = p.coords.map(([lo, la]) => getNode(la, lo))
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]!
      const b = nodes[i + 1]!
      if (a === b) continue
      const m = metresBetween(lat[a]!, lon[a]!, lat[b]!, lon[b]!)
      if (m < 0.05) continue
      edges.push([
        a, b,
        Math.round(m * 10) / 10,
        footOk ? round2(m / WALK) : -1,
        bikeOk ? round2(m / BIKE) : -1,
        flags,
      ])
    }

    // Stitch the path onto the base network so it is reachable.
    for (const n of nodes) {
      const { i, m } = nearestBase(lat[n]!, lon[n]!)
      if (i < 0 || m > CONNECT_M || i === n) continue
      edges.push([
        n, i,
        Math.round(m * 10) / 10,
        footOk ? round2(m / WALK) : -1,
        bikeOk ? round2(m / BIKE) : -1,
        flags,
      ])
    }
  }

  return { lat, lon, edges }
}
