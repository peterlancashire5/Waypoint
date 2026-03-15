-- Phase 6: Add per-leg city fields to leg_bookings.
-- Required for incomplete journey detection: knowing where each leg started
-- and ended lets us match a new transport booking as the "next leg" of an
-- in-progress connection (e.g. Nice→Milan leg 1, then detect Milan→Rome as leg 2).

ALTER TABLE leg_bookings
  ADD COLUMN IF NOT EXISTS origin_city      TEXT,
  ADD COLUMN IF NOT EXISTS destination_city TEXT;
