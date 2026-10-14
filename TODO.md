# TODO — datasets with no public source yet

Ground rule for this repo: **ship real data or ship nothing.** Every dataset below
was deliberately left out rather than filled with plausible-looking invented rows.
Each one has a place to plug into once a real source exists.

This is a fork of [ni5arga/iitk](https://github.com/ni5arga/iitk) (MIT),
re-pointed at Delhi Technological University. Anything IITK-specific
(faculty directory, mess feed, pixel seed art) was removed or stubbed —
see `scripts/fetch-web.mjs`.

## Blocked on a source

| Dataset | Wanted for | Why it's not here |
|---|---|---|
| **Faculty directory** | `cse professor` | No public machine-readable faculty feed found on `dtu.ac.in`. Needs a published directory or a CSV drop. Code paths (`showPerson`, search `person` kind) are kept and activate automatically if `data/live/faculty.json` appears. |
| **Mess / canteen menus** | `mess dinner` | No public canteen-menu API found. The mess intent, `menuSections` and search `mess` kind are kept and activate automatically if `data/live/mess.json` appears. |
| **Societies & clubs** | `society robotics` | No public roster found. Needs a live society list or per-society site scrape. |
| **Courses & timetable** | `AP101`, room-now | No public schedule found. Needs an authenticated export or a per-semester CSV drop. |
| **Notices** | `notices`, deadline search | No public notice feed found on `dtu.ac.in`. |
| **Bus / shuttle timings** | `bus`, `metro` | Nothing machine-readable found. A hand-typed table is fine here **as long as it is transcribed from a real circular** and cites it. |
| **Lost & found** | `lost id card` | Inherently a live board, not a checked-in file. Wants a small backend or a form-backed sheet. Do not commit a static list. |

## The admin-mode escape hatch

Unlike upstream, this fork does not have to wait for sources: **admin mode (✎)**
lets editors add places, draw paths and save named routes directly, persisted to
`localStorage` immediately and to Supabase when `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` are set. Use it for gaps that OSM will not take
(canteen names, shortcut paths). Everything OSM *will* take still belongs in
OpenStreetMap — map it once there and this picks it up on the next `npm run fetch`.

## Before publicising the URL

- [ ] Replace the open Supabase policies in `supabase/schema.sql` with an admin role + logins.
- [ ] Survey admin-seeded coordinates against satellite (anything marked "verify" in `data/curated/places.json`).
- [ ] Map missing footways in OSM so routing detours tighten (smoke allows ~10x today).

## How to add a live source later

1. Write a fetcher in `scripts/fetch-web.mjs`, writing to `data/live/<name>.json`.
   Include `_source` (the URL) and `_fetched` (ISO date) in the output.
2. Merge it into the payload in `scripts/build-data.mjs`.
3. Register it as a search domain in `src/search/engine.ts`.

For anything hand-typed, put it in `data/curated/` with an `anchor` naming a real
OSM feature (never raw coordinates), and cite where the numbers came from.

## Better than any of the above

Most of the physical stuff — water coolers, cycle stands, ATMs, opening hours,
step-free access — belongs in **OpenStreetMap** itself.
Map it once there and this app picks it up on the next `npm run fetch`, along with
every other OSM consumer. `data/curated/places.json` is only for things OSM will
not accept.
