-- Add TowBook account name column to jobs table.
-- Run in: Supabase Dashboard → SQL Editor

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tb_account text;
