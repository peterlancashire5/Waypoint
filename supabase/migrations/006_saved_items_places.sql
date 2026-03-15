-- ============================================================
-- Waypoint — Migration 006: saved_items place columns
-- ============================================================
-- Updates the saved_items table to support the Saved Places
-- feature: revised categories, city, coordinates, address, and
-- source image / Google Place ID columns.
-- ============================================================

-- Drop the old category constraint (Postgres auto-names it
-- {table}_{column}_check when defined inline in CREATE TABLE).
alter table public.saved_items
  drop constraint if exists saved_items_category_check;

-- New seven-category constraint used by the place parser and UI.
alter table public.saved_items
  add constraint saved_items_category_check
  check (category in (
    'Restaurants',
    'Bars',
    'Museums',
    'Activities',
    'Sights',
    'Shopping',
    'Other'
  ));

-- City name — used for auto-matching to a stop and for inbox display.
alter table public.saved_items
  add column if not exists city text;

-- Original screenshot / photo the user uploaded (before AI parsing).
alter table public.saved_items
  add column if not exists source_image_url text;

-- Full address returned by Google Places enrichment.
alter table public.saved_items
  add column if not exists address text;

-- Coordinates returned by Google Places enrichment.
alter table public.saved_items
  add column if not exists latitude float;

alter table public.saved_items
  add column if not exists longitude float;

-- Google Place ID — stored for future deduplication / deep-links.
alter table public.saved_items
  add column if not exists google_place_id text;

-- Index to speed up city-based auto-match queries.
create index if not exists saved_items_creator_city_idx
  on public.saved_items (creator_id, city);
