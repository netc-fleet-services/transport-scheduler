-- ═══════════════════════════════════════════════
-- NETC Transport Planner — Initial Schema
--
-- Run this in: Supabase Dashboard → SQL Editor
-- (Project → SQL Editor → New query → paste → Run)
-- ═══════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id            text PRIMARY KEY,
  yard_id       text        NOT NULL,
  driver_id     integer,
  pickup_zip    text,
  drop_zip      text,
  pickup_addr   text,
  drop_addr     text,
  tb_call_num   text,
  tb_desc       text,
  tb_scheduled  text,
  tb_reason     text,
  tb_driver     text,
  priority      text        NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('urgent', 'normal', 'flexible')),
  status        text        NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'active', 'complete', 'cancelled')),
  day           text        NOT NULL,  -- ISO date string "YYYY-MM-DD"
  notes         text,
  stops         jsonb       NOT NULL DEFAULT '[]',
  started_at    timestamptz,
  completed_at  timestamptz,
  added_at      timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drivers (
  id    integer PRIMARY KEY,
  name  text    NOT NULL,
  truck text,
  yard  text    NOT NULL
);

-- Key/value store for app-wide settings (hpd, staffing overrides, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key   text  PRIMARY KEY,
  value jsonb NOT NULL
);

-- ── Auto-update updated_at ───────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Indexes ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS jobs_day_idx    ON jobs (day);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_driver_idx ON jobs (driver_id);

-- ── Row Level Security ───────────────────────────
-- The Supabase anon key is safe to expose publicly because RLS ensures
-- only users with a valid authenticated session can read or write data.

ALTER TABLE jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users only" ON jobs
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated users only" ON drivers
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated users only" ON settings
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── Setup Instructions ───────────────────────────
-- After running this SQL:
--
-- 1. Go to Authentication → Users → Add User
--    Email: team@netc.internal  (must match TEAM_EMAIL in js/supabase.js)
--    Password: <your shared site password>  ← this is what dispatchers type to log in
--
-- 2. Copy your project URL and anon key from Settings → API
--    Add them as GitHub repository secrets: SUPABASE_URL and SUPABASE_ANON_KEY
