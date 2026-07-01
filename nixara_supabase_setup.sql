-- ============================================================
-- Nixara Analytics — Supabase Schema Setup
-- Run this entire file in the Supabase SQL Editor:
--   https://app.supabase.com → your project → SQL Editor → New query
-- ============================================================

-- ── 1. Events table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nixara_events (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id  TEXT        NOT NULL,
    event_type  TEXT        NOT NULL,
    data_source TEXT,
    report_type TEXT,
    role        TEXT,
    timeframe   TEXT,
    data_rows   INTEGER,
    data_cols   INTEGER
);

-- ── 2. Row Level Security ───────────────────────────────────
ALTER TABLE nixara_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_insert"
    ON nixara_events
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "allow_service_select"
    ON nixara_events
    FOR SELECT
    TO authenticated
    USING (true);

-- ── 3. Index for dashboard queries ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_nixara_events_created_at  ON nixara_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nixara_events_event_type  ON nixara_events (event_type);
CREATE INDEX IF NOT EXISTS idx_nixara_events_session_id  ON nixara_events (session_id);

-- ── 4. Add referrer column ──────────────────────────────────
ALTER TABLE nixara_events ADD COLUMN IF NOT EXISTS referrer TEXT;

-- ── 5. Decisions table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS nixara_decisions (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id      TEXT,
    report_type     TEXT,
    role            TEXT,
    dataset_name    TEXT,
    decision        TEXT,
    notes           TEXT,
    timeframe       TEXT,
    question        TEXT,
    -- Task 13: which specific recommendation was acted on
    recommendation  TEXT,
    -- Task 13: who is responsible for implementing the action
    owner           TEXT,
    -- Task 14: reason for postponing (Budget constraint / Need more data / Not a priority now)
    postpone_reason TEXT
);

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

CREATE INDEX IF NOT EXISTS idx_nixara_decisions_created_at ON nixara_decisions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nixara_decisions_decision   ON nixara_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_nixara_decisions_session_id ON nixara_decisions (session_id);

-- ── 6. Outcomes table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS nixara_outcomes (
    id             BIGSERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decision_id    BIGINT REFERENCES nixara_decisions(id) ON DELETE SET NULL,
    session_id     TEXT,
    metric_name    TEXT,
    metric_before  NUMERIC,
    metric_after   NUMERIC,
    metric_unit    TEXT,
    outcome_rating TEXT,
    outcome_notes  TEXT
);

ALTER TABLE nixara_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcomes_allow_anon_insert"
    ON nixara_outcomes
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "outcomes_allow_service_select"
    ON nixara_outcomes
    FOR SELECT
    TO authenticated
    USING (true);

CREATE INDEX IF NOT EXISTS idx_nixara_outcomes_created_at  ON nixara_outcomes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nixara_outcomes_decision_id ON nixara_outcomes (decision_id);
CREATE INDEX IF NOT EXISTS idx_nixara_outcomes_rating      ON nixara_outcomes (outcome_rating);

-- ── 7. get_decision_by_id RPC — Fix H3 ────────────────────
-- Allows the anon key to fetch one decision by ID without SELECT on the table.
-- SECURITY DEFINER = runs as postgres owner, bypasses RLS.

DROP FUNCTION IF EXISTS get_decision_by_id(BIGINT);

CREATE OR REPLACE FUNCTION get_decision_by_id(p_id BIGINT)
RETURNS TABLE (
    id              BIGINT,
    created_at      TIMESTAMPTZ,
    session_id      TEXT,
    report_type     TEXT,
    role            TEXT,
    dataset_name    TEXT,
    decision        TEXT,
    notes           TEXT,
    timeframe       TEXT,
    question        TEXT,
    recommendation  TEXT,
    owner           TEXT,
    postpone_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id, d.created_at, d.session_id, d.report_type, d.role,
        d.dataset_name, d.decision, d.notes, d.timeframe, d.question,
        d.recommendation, d.owner, d.postpone_reason
    FROM nixara_decisions d
    WHERE d.id = p_id
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_decision_by_id(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_decision_by_id(BIGINT) TO authenticated;

-- ── 8. Migration — add columns to existing nixara_decisions ─
-- Run these if the decisions table already existed before this script.
-- IF NOT EXISTS means they're safe to run even on a fresh setup.

ALTER TABLE nixara_decisions ADD COLUMN IF NOT EXISTS recommendation  TEXT;
ALTER TABLE nixara_decisions ADD COLUMN IF NOT EXISTS owner           TEXT;
ALTER TABLE nixara_decisions ADD COLUMN IF NOT EXISTS postpone_reason TEXT;

-- ── 9. Verify setup ────────────────────────────────────────
SELECT COUNT(*) AS total_events    FROM nixara_events;
SELECT COUNT(*) AS total_decisions FROM nixara_decisions;
SELECT COUNT(*) AS total_outcomes  FROM nixara_outcomes;
