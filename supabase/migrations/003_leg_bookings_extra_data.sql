-- Add extra_data JSONB column to leg_bookings for transport-type-specific fields
-- (gate/terminal for flights, coach/platform/stations for trains,
--  pickup/dropoff for buses, deck/cabin/port for ferries)
ALTER TABLE leg_bookings ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT NULL;
