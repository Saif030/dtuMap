-- DTU campus map — admin overlay tables.
--
-- Everything an admin draws in admin mode (✎) lives here, separate from the
-- OSM-derived base data in public/data/*.json. The app merges both at load:
-- Supabase rows win over nothing (they are purely additive), keyed by id.
--
-- Run once in the Supabase dashboard (SQL editor) or via `supabase db push`.
-- Prototype ships with OPEN policies (no auth, per project decision).
-- Before publicising the URL: enable RLS properly — replace the open policies
-- with an admin role check, e.g.
--   create policy "admin write" on admin_places for all
--     using (auth.jwt() ->> 'role' = 'admin');
-- and hand out logins. The app code needs no change.

create table if not exists admin_places (
  id text primary key,
  name text not null,
  cat text not null default 'admin',
  lat double precision not null,
  lon double precision not null,
  props jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists admin_paths (
  id text primary key,
  name text not null,
  coords jsonb not null default '[]',
  tags jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists admin_routes (
  id text primary key,
  name text not null,
  from_lat double precision not null,
  from_lon double precision not null,
  from_label text not null default '',
  to_lat double precision not null,
  to_lon double precision not null,
  to_label text not null default '',
  profile text not null default 'foot',
  updated_at timestamptz not null default now()
);

create table if not exists map_config (
  id integer primary key check (id = 1),
  theme text,
  colors jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ── prototype open access (see warning above) ─────────────────────────────

alter table admin_places enable row level security;
alter table admin_paths enable row level security;
alter table admin_routes enable row level security;
alter table map_config enable row level security;

drop policy if exists "open read" on admin_places;
drop policy if exists "open write" on admin_places;
drop policy if exists "open read" on admin_paths;
drop policy if exists "open write" on admin_paths;
drop policy if exists "open read" on admin_routes;
drop policy if exists "open write" on admin_routes;
drop policy if exists "open read" on map_config;
drop policy if exists "open write" on map_config;

create policy "open read"  on admin_places for select using (true);
create policy "open write" on admin_places for all using (true) with check (true);
create policy "open read"  on admin_paths  for select using (true);
create policy "open write" on admin_paths  for all using (true) with check (true);
create policy "open read"  on admin_routes for select using (true);
create policy "open write" on admin_routes for all using (true) with check (true);
create policy "open read"  on map_config   for select using (true);
create policy "open write" on map_config   for all using (true) with check (true);
