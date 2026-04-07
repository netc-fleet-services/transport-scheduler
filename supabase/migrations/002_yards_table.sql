-- ═══════════════════════════════════════════════
-- NETC Transport Planner — Yards Table
-- Run after 001_initial_schema.sql
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS yards (
  id    text PRIMARY KEY,  -- slug used throughout the app, e.g. 'exeter'
  short text NOT NULL,     -- display name, e.g. 'Exeter'
  addr  text NOT NULL,     -- full address used for geocoding
  zip   text NOT NULL
);

ALTER TABLE yards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users only" ON yards
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the four default yards.
-- ON CONFLICT DO NOTHING means re-running this migration is safe.
INSERT INTO yards (id, short, addr, zip) VALUES
  ('exeter',     'Exeter',       '156 Epping Rd, Exeter NH',        '03833'),
  ('pembroke',   'Pembroke',     '107 Sheep Davis Rd, Pembroke NH', '03275'),
  ('mattbrowns', 'Matt Brown''s','26 Thibeault Dr, Bow NH',         '03304'),
  ('rays',       'Ray''s Saco',  '305 Bradley St, Saco ME',         '04072')
ON CONFLICT (id) DO NOTHING;
