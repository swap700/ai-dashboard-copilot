-- ============================================================
-- Nixara Analytics — Supabase Schema Setup
-- Run this entire file in the Supabase SQL Editor:
--   https://app.supabase.com → your project → SQL Editor → New query
-- ============================================================

-- ── 1. Events table ────────────────────────────────────────
-- Every tracked action (session start, file upload, report generation, etc.)
-- is a row in this single table. Simple and queryable.

CREATE TABLE IF NOT EXISTS nixara_events (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id  TEXT        NOT NULL,           -- UUID generated per browser session
    event_type  TEXT        NOT NULL,           -- 'session_start' | 'file_upload' | 'bi_connect' | 'report_generate'
    data_source TEXT,                           -- 'csv' | 'xlsx' | 'tableau' | 'powerbi'
    report_type TEXT,                           -- 'Executive Summary' | 'Operational Detail' | 'Risk Report'
    role        TEXT,                           -- 'COO' | 'CEO' | 'CFO' | 'Sales Lead' | 'Operations Lead' | 'Board'
    timeframe   TEXT,                           -- 'Next 30 days' | 'This quarter' | 'This year'
    data_rows   INTEGER,                        -- number of rows in uploaded dataset
    data_cols   INTEGER                         -- number of columns in uploaded dataset
);

-- ── 2. Row Level Security ───────────────────────────────────
-- Enable RLS so the anon key can INSERT but cannot SELECT.
-- You (admin) read via the service_role key from the dashboard.

ALTER TABLE nixara_events ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including the anon key used in the Streamlit app) to INSERT events.
CREATE POLICY "allow_anon_insert"
    ON nixara_events
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Only authenticated users (you, using service_role key) can SELECT.
-- The HTML analytics dashboard uses the service_role key, which bypasses RLS.
CREATE POLICY "allow_service_select"
    ON nixara_events
    FOR SELECT
    TO authenticated
    USING (true);

-- ── 3. Index for dashboard queries ─────────────────────────
-- Most dashboard queries group or filter by created_at and event_type.
CREATE INDEX IF NOT EXISTS idx_nixara_events_created_at  ON nixara_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nixara_events_event_type  ON nixara_events (event_type);
CREATE INDEX IF NOT EXISTS idx_nixara_events_session_id  ON nixara_events (session_id);

-- ── 4. Add referrer column (traffic source tracking) ───────
-- Run this if you already created the table and need to add referrer support.
ALTER TABLE nixara_events ADD COLUMN IF NOT EXISTS referrer TEXT;
-- Values: 'linkedin' | 'google' | 'twitter' | 'github' | 'web' | 'direct' | any utm_source value

-- ── 5. Decisions table (Phase 1 — Decision Tracking) ──────
-- Stores every Approve / Reject / Postpone decision users make on a report.

CREATE TABLE IF NOT EXISTS nixara_decisions (
    id            BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id    TEXT,                            -- matches nixara_events.session_id
    report_type   TEXT,                            -- 'Executive Summary' | 'Operational Detail' | 'Risk Report'
    role          TEXT,                            -- the analyst role used when generating the report
    dataset_name  TEXT,                            -- filename or 'tableau'
    decision      TEXT,                            -- 'approved' | 'rejected' | 'postponed'
    notes         TEXT,                            -- optional free-text context from the user
    timeframe     TEXT,                            -- timeframe used for the report
    question      TEXT                             -- the business question / decision context
);

-- RLS: anon key can INSERT (from Streamlit app), only service_role can SELECT (from analytics dashboard)
ALTER TABLE nixara_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decisions_allow_anon_insert"
    ON nixara_decisions
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "decisions_allow_service_select"
    ON nixara_decisions
    FOR SELECT
    TO authenticated
    USING (true);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_nixara_decisions_created_at ON nixara_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nixara_decisions_decision   ON nixara_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_nixara_decisions_session_id ON nixara_decisions (session_id);

-- ── 6. Verify setup ────────────────────────────────────────
SELECT COUNT(*) AS total_events    FROM nixara_events;
SELECT COUNT(*) AS total_decisions FROM nixara_decisions;
