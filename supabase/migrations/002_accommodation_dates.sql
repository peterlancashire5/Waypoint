-- ============================================================
-- Waypoint — Add check_in_date / check_out_date to accommodation
-- These are calendar date fields (separate from check_in / check_out
-- which are time-of-day fields). Populated from the parsed booking PDF.
-- ============================================================

alter table public.accommodation
  add column if not exists check_in_date  date,
  add column if not exists check_out_date date;
