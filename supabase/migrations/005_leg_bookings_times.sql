-- Phase 7: Add departure/arrival time columns to leg_bookings.
-- These store per-segment times parsed from booking PDFs so that the
-- journey detail screen can display accurate departure/arrival info
-- for each leg of a multi-leg connection.

ALTER TABLE leg_bookings
  ADD COLUMN IF NOT EXISTS departure_date TEXT,
  ADD COLUMN IF NOT EXISTS departure_time TEXT,
  ADD COLUMN IF NOT EXISTS arrival_date   TEXT,
  ADD COLUMN IF NOT EXISTS arrival_time   TEXT;
