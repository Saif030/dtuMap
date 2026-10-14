// DTU live sources — none configured yet.
//
// IITK pulled faculty + mess menus from public feeds. DTU has no equivalent
// public machine-readable feed, so per the "real data or no data" rule this is
// intentionally a no-op. Admin-mode edits (Supabase + localStorage) are the
// live layer for DTU until a real source exists.
//
//   node scripts/fetch-web.mjs   # always succeeds, fetches nothing yet

console.log('fetch-web: no live sources configured for DTU yet — nothing to do.')
console.log('Use admin mode in the app to add places/paths, which persist to Supabase.')
