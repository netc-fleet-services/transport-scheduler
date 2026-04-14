-- Real lat/lon per job, populated by sync_calls.py via Nominatim.
-- Replaces the coarse 3-digit ZIP3 lookup for distance + city-label purposes.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lon double precision,
  ADD COLUMN IF NOT EXISTS drop_lat   double precision,
  ADD COLUMN IF NOT EXISTS drop_lon   double precision;
