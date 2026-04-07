-- ═══════════════════════════════════════════════
-- NETC Transport Planner — Geocache Table
-- Run after 002_yards_table.sql
-- ═══════════════════════════════════════════════
-- Stores Nominatim lookup results keyed by full address string.
-- Shared across all users so each address is only looked up once.

CREATE TABLE IF NOT EXISTS geocache (
  addr  text             PRIMARY KEY,  -- full address string used as lookup key
  lat   double precision NOT NULL,
  lon   double precision NOT NULL,
  name  text                           -- short display name, e.g. "Exeter, NH"
);

ALTER TABLE geocache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users only" ON geocache
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
