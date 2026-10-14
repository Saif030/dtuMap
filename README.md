# DTU Map — Delhi Technological University campus map

A fast, offline-friendly campus map for DTU (Shahbad Daulatpur, Delhi):
searchable places, walking/cycling routing over the real path network, and an
**admin mode (✎)** to add markings, draw shortcut paths and save named routes —
all editable in the browser and synced to a shared database.

Forked from [ni5arga/iitk](https://github.com/ni5arga/iitk) (MIT) and re-pointed
at DTU: OSM way `111212532`, centre `[77.1165, 28.75]`.

## Running it

```bash
npm install
npm run fetch      # OpenStreetMap via Overpass — cached, use --force to refetch
npm run dev        # builds data, serves at localhost:5173
```

`npm test` — typecheck + rebuild data + smoke test.
`npm run verify` — loads the app in headless Chrome and asserts it works (needs Chrome).

## How it works

**No tile server.** The basemap is drawn from our own OSM extract
(`public/data/geo.json`), so there is no API key or tile budget.

**Routing.** A\* over the OSM path network, costs baked in seconds. Admin-drawn
paths merge into the graph at load (`src/admin/graph.ts`), so a new shortcut
routes immediately — no rebuild.

**Search.** One flat index over places, layers and commands. Sub-0.3 ms queries.

**Data rule: real data or no data.** No faculty/mess feeds are configured for
DTU (see `TODO.md`) — those features simply stay absent until a real source
exists. The search, panel and smoke tests all degrade gracefully.

## Admin mode ✎

Click the ✎ button (or open with `?admin=1`):

| Task | How |
|---|---|
| Add a place | `+ place` → click map → fill form → Save |
| Edit / move / delete | Click any admin pin (or `Move` then click new spot) |
| Draw a shortcut path | `〜 path` → click corners → Done → Save (joins routing) |
| Named A→B routes | `⇄ routes` → pick endpoints → Save → Show |
| Recolour / theme | `🎨 map` → per-category colours, syncs to DB |
| Export / import | `⇅` → JSON (places match `data/curated/` format) |

**Storage:** local-first. Every edit saves to `localStorage` instantly and works
offline. Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (see `.env.example`,
schema in `supabase/schema.sql`) to sync across devices — the shared copy wins
on fresh loads, local drafts are never wiped by an empty cloud.

> **Prototype warning:** there is no login yet — anyone with the URL can edit.
> Add Supabase Auth + an admin RLS role (notes in `supabase/schema.sql`) before
> publicising.

## Layout

```
data/raw/        OSM dumps (boundary/pois/buildings/highways/land)
data/curated/    hand-surveyed places (lat/lon cited, or anchor to OSM names)
data/live/       empty — no DTU live feeds configured yet
scripts/
  fetch-osm.mjs    Overpass, retries across mirrors
  fetch-web.mjs    stub (no DTU live sources yet)
  build-data.mjs   normalise -> public/data/{campus,geo,graph}.json
  smoke.mjs        search, routing, admin-merge and style assertions
src/
  map/style.ts     MapLibre style built from our GeoJSON
  route/router.ts  A* with a CSR adjacency and a binary heap
  search/engine.ts index, scoring, intents
  admin/           store (local+Supabase), graph merge, admin panel UI
  ui/              palette + detail panel + theme
supabase/
  schema.sql       tables + (open, prototype) policies
```

Map data © OpenStreetMap contributors (ODbL). Code MIT.
