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

-- ============================================================
-- 10. Previously-undocumented RPCs — reconstructed from the live database
-- (2026-08). These existed only in the Supabase SQL editor and were never
-- committed here, which is itself a gap worth avoiding going forward: this
-- file should be the source of truth for schema/RPCs, not a partial record
-- of it. Definitions below match what's deployed as of this commit,
-- including the 2026-08 security fixes (see section 11).
-- ============================================================

CREATE OR REPLACE FUNCTION log_decision_record(
  p_session_id TEXT,
  p_report_type TEXT,
  p_role TEXT,
  p_dataset_name TEXT,
  p_decision TEXT,
  p_notes TEXT DEFAULT '',
  p_timeframe TEXT DEFAULT '',
  p_question TEXT DEFAULT '',
  p_owner TEXT DEFAULT NULL,
  p_recommendation TEXT DEFAULT NULL,
  p_postpone_reason TEXT DEFAULT NULL
)
RETURNS TABLE (id BIGINT, public_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_public_id TEXT;
BEGIN
  INSERT INTO nixara_decisions (
    session_id, report_type, role, dataset_name, decision,
    notes, timeframe, question, owner, recommendation, postpone_reason
  ) VALUES (
    p_session_id, p_report_type, p_role, p_dataset_name, p_decision,
    p_notes, p_timeframe, p_question, p_owner, p_recommendation, p_postpone_reason
  ) RETURNING nixara_decisions.id, nixara_decisions.public_id INTO v_id, v_public_id;

  RETURN QUERY SELECT v_id, v_public_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_decision_record(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION log_decision_record(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ============================================================
-- 11. Security fixes (2026-08) — sequential-ID enumeration + write IDOR.
--
-- Prior state: get_decision_by_id(bigint) and get_outcome_for_decision(bigint)
-- were SECURITY DEFINER + anon-executable, keyed on the sequential BIGSERIAL
-- id — anyone could script id=1,2,3... and harvest every decision/outcome
-- ever logged, across all sessions. update_decision_choice(bigint,...) had
-- the same shape of problem but as a WRITE — no ownership check meant any
-- caller could overwrite any other session's decision.
--
-- The "find a decision from a previous session" feature is an intentional
-- cross-session READ, so the fix for the two lookups is not session-scoping
-- (that would break the feature) — it's replacing the guessable sequential
-- key with an unguessable random token (public_id). The WRITE path
-- (update_decision_choice) has no such legitimate cross-session use case, so
-- it's fixed with session_id ownership scoping instead.
-- ============================================================

ALTER TABLE nixara_decisions
  ADD COLUMN IF NOT EXISTS public_id TEXT;

UPDATE nixara_decisions
SET public_id = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
WHERE public_id IS NULL;

ALTER TABLE nixara_decisions
  ALTER COLUMN public_id SET DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_nixara_decisions_public_id ON nixara_decisions (public_id);

CREATE OR REPLACE FUNCTION get_decision_by_public_id(p_public_id TEXT)
RETURNS TABLE (
  id BIGINT, created_at TIMESTAMPTZ, session_id TEXT, report_type TEXT,
  role TEXT, dataset_name TEXT, decision TEXT, notes TEXT, timeframe TEXT,
  question TEXT, recommendation TEXT, owner TEXT, postpone_reason TEXT, public_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.created_at, d.session_id, d.report_type, d.role,
         d.dataset_name, d.decision, d.notes, d.timeframe, d.question,
         d.recommendation, d.owner, d.postpone_reason, d.public_id
  FROM nixara_decisions d
  WHERE d.public_id = p_public_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_decision_by_public_id(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_decision_by_public_id(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION get_outcome_for_public_id(p_public_id TEXT)
RETURNS TABLE (
  id BIGINT, metric_name TEXT, metric_before NUMERIC, metric_after NUMERIC,
  metric_unit TEXT, outcome_rating TEXT, outcome_notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.metric_name, o.metric_before, o.metric_after,
         o.metric_unit, o.outcome_rating, o.outcome_notes
  FROM nixara_outcomes o
  JOIN nixara_decisions d ON d.id = o.decision_id
  WHERE d.public_id = p_public_id
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_outcome_for_public_id(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_outcome_for_public_id(TEXT) TO authenticated;

-- Old sequential-id-keyed lookups: revoked, no longer callable by anon/authenticated.
-- Left in place (not dropped) only so historical direct-SQL debugging by an
-- admin/service-role connection still works.
REVOKE EXECUTE ON FUNCTION get_decision_by_id(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_decision_by_id(BIGINT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION get_outcome_for_decision(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_outcome_for_decision(BIGINT) FROM authenticated;

DROP FUNCTION IF EXISTS update_decision_choice(BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION update_decision_choice(
  p_id BIGINT,
  p_decision TEXT,
  p_postpone_reason TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BIGINT;
BEGIN
  UPDATE nixara_decisions
  SET decision        = p_decision,
      postpone_reason = p_postpone_reason
  WHERE id = p_id
    AND session_id = p_session_id
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION update_decision_choice(BIGINT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_decision_choice(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- rls_auto_enable() is a DDL event-trigger helper with no legitimate reason
-- to be reachable over the public REST RPC surface — locking it down per
-- Supabase's own security advisor recommendation.
REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM public;

-- ── 12. Verify setup ────────────────────────────────────────
SELECT COUNT(*) AS total_events    FROM nixara_events;
SELECT COUNT(*) AS total_decisions FROM nixara_decisions;
SELECT COUNT(*) AS total_outcomes  FROM nixara_outcomes;

-- ============================================================
-- 13. Shared quota counters (H3) — 2026-09
--
-- Prior state: the only limit on free-tier report generation (which spends
-- the SERVER's OpenAI key) was an HttpOnly cookie, plus an in-memory Map in
-- edge middleware. The cookie is cleared by incognito or by curl. The Map is
-- per-instance and resets on every cold start, so in a serverless deployment
-- it is close to no limit at all. There was no global spend cap anywhere.
-- Net effect: an unauthenticated caller could run unlimited GPT-4o traffic
-- on the operator's card.
--
-- This table is the shared, atomic counter that replaces both. One row per
-- bucket ("ip:1.2.3.4:generate", "global:generate", ...), fixed-window.
--
-- NOTE: execute is granted to service_role ONLY, never to anon. If anon could
-- call consume_quota it could burn the global bucket itself and deny service
-- to everyone. The app reaches this through a server-only Supabase client
-- using SUPABASE_SERVICE_ROLE_KEY.
-- ============================================================

CREATE TABLE IF NOT EXISTS nixara_quota (
    bucket       TEXT PRIMARY KEY,
    count        BIGINT      NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nixara_quota ENABLE ROW LEVEL SECURITY;
-- No policies: RLS on with zero policies denies anon/authenticated entirely.
-- service_role bypasses RLS, and the RPC below is SECURITY DEFINER.

REVOKE ALL ON TABLE nixara_quota FROM anon, authenticated;

-- Atomic fixed-window consume. Single statement, so concurrent callers
-- serialise on the row lock rather than racing a read-then-write.
CREATE OR REPLACE FUNCTION consume_quota(
    p_bucket         TEXT,
    p_limit          INT,
    p_window_seconds INT
)
RETURNS TABLE (allowed BOOLEAN, used BIGINT, resets_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count BIGINT;
    v_start TIMESTAMPTZ;
BEGIN
    INSERT INTO nixara_quota AS q (bucket, count, window_start)
    VALUES (p_bucket, 1, NOW())
    ON CONFLICT (bucket) DO UPDATE
        SET count = CASE
                WHEN NOW() - q.window_start >= make_interval(secs => p_window_seconds)
                THEN 1 ELSE q.count + 1 END,
            window_start = CASE
                WHEN NOW() - q.window_start >= make_interval(secs => p_window_seconds)
                THEN NOW() ELSE q.window_start END
    RETURNING q.count, q.window_start INTO v_count, v_start;

    RETURN QUERY SELECT
        (v_count <= p_limit),
        v_count,
        v_start + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE EXECUTE ON FUNCTION consume_quota(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION consume_quota(TEXT, INT, INT) TO service_role;

-- Housekeeping: drop rows whose window closed long ago. Safe to run on a
-- schedule (pg_cron) or manually; nothing depends on the history.
CREATE OR REPLACE FUNCTION prune_quota(p_older_than_hours INT DEFAULT 48)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted BIGINT;
BEGIN
    DELETE FROM nixara_quota
    WHERE window_start < NOW() - make_interval(hours => p_older_than_hours);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION prune_quota(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION prune_quota(INT) TO service_role;

CREATE INDEX IF NOT EXISTS idx_nixara_quota_window_start ON nixara_quota (window_start);

-- ============================================================
-- 14. Outcome write IDOR (H4) — 2026-09
--
-- Section 11 replaced the guessable sequential key with an unguessable
-- public_id token for the decision READ path, and session-scoped the decision
-- WRITE path. The outcome write was missed.
--
-- Prior state: the app inserted straight into nixara_outcomes with a
-- client-supplied decision_id, under a policy of WITH CHECK (true) and with no
-- ownership check at all. decision_id is a sequential BIGSERIAL, so any caller
-- could script decision_id = 1, 2, 3 ... and attach fabricated outcomes to
-- every decision anyone had ever logged. Because get_outcome_for_public_id
-- returns the most recent outcome for a decision, a legitimate user looking up
-- their own decision would then be shown the injected result.
--
-- That is not only a data-integrity bug: the outcome table IS the accuracy
-- record the product is built on, so a poisoned row corrupts the one number
-- Nixara asks to be judged on.
--
-- Fix, matching the model section 11 established: the write is keyed on the
-- unguessable public_id token, never on the sequential id, and it goes through
-- a SECURITY DEFINER RPC so anon needs no direct INSERT on the table. Knowing
-- the token is the capability, which preserves the intentional cross-session
-- "log an outcome for a decision from a previous session" flow.
-- ============================================================

-- One outcome per decision. The UI already tried to enforce this; make it real.
-- Historical duplicates are kept: only the most recent per decision survives as
-- the canonical row, matching what get_outcome_for_public_id already returns.
DELETE FROM nixara_outcomes o
USING nixara_outcomes newer
WHERE o.decision_id IS NOT NULL
  AND o.decision_id = newer.decision_id
  AND (newer.created_at, newer.id) > (o.created_at, o.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nixara_outcomes_one_per_decision
    ON nixara_outcomes (decision_id)
    WHERE decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION log_outcome_record(
    p_public_id      TEXT,
    p_session_id     TEXT,
    p_metric_name    TEXT,
    p_metric_before  NUMERIC,
    p_metric_after   NUMERIC,
    p_metric_unit    TEXT,
    p_outcome_rating TEXT,
    p_notes          TEXT DEFAULT ''
)
RETURNS TABLE (id BIGINT, already_existed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_decision_id BIGINT;
    v_existing_id BIGINT;
    v_new_id      BIGINT;
BEGIN
    -- Knowing the token is the capability. An unknown token resolves to
    -- nothing and the function returns no rows.
    SELECT d.id INTO v_decision_id
    FROM nixara_decisions d
    WHERE d.public_id = p_public_id
    LIMIT 1;

    IF v_decision_id IS NULL THEN
        RETURN;
    END IF;

    IF p_outcome_rating IS NULL OR p_outcome_rating NOT IN ('exceeded', 'met', 'missed') THEN
        RAISE EXCEPTION 'invalid outcome_rating';
    END IF;

    -- Idempotent: never silently overwrite an outcome that is already recorded.
    SELECT o.id INTO v_existing_id
    FROM nixara_outcomes o
    WHERE o.decision_id = v_decision_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, TRUE;
        RETURN;
    END IF;

    INSERT INTO nixara_outcomes (
        decision_id, session_id, metric_name, metric_before,
        metric_after, metric_unit, outcome_rating, outcome_notes
    ) VALUES (
        v_decision_id, p_session_id, LEFT(COALESCE(p_metric_name, ''), 200), p_metric_before,
        p_metric_after, LEFT(COALESCE(p_metric_unit, ''), 40), p_outcome_rating,
        LEFT(COALESCE(p_notes, ''), 2000)
    )
    RETURNING nixara_outcomes.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION log_outcome_record(TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION log_outcome_record(TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO authenticated;

-- Direct anon INSERT is what made the IDOR reachable. The RPC above is now the
-- only supported write path, so drop the policy and the table-level grant.
DROP POLICY IF EXISTS "outcomes_allow_anon_insert" ON nixara_outcomes;
REVOKE INSERT ON TABLE nixara_outcomes FROM anon;

-- Same reasoning for the decisions table: log_decision_record (section 10) is
-- the only supported write path, so the blanket anon INSERT policy is dead
-- weight that only widens the surface.
DROP POLICY IF EXISTS "decisions_allow_anon_insert" ON nixara_decisions;
REVOKE INSERT ON TABLE nixara_decisions FROM anon;

-- ============================================================
-- 15. The section 11 revokes never took effect (H5) — 2026-09
--
-- Section 11 closed the sequential-id enumeration IDOR by moving the lookups
-- to an unguessable public_id token and then revoking the old id-keyed RPCs:
--
--     REVOKE EXECUTE ON FUNCTION get_decision_by_id(BIGINT) FROM anon;
--
-- That revoke does nothing. Postgres grants EXECUTE to PUBLIC by default on
-- every newly created function, and anon is a member of PUBLIC. Revoking from
-- anon leaves the PUBLIC grant untouched, so anon still resolves EXECUTE
-- through it. Verified on a clean apply of this file:
--
--     get_decision_by_id  proacl = {=X/postgres, postgres=X/postgres}
--                                   ^^ "=X" is the grant to PUBLIC
--     SET ROLE anon; SELECT * FROM get_decision_by_id(1);  -- returns the row
--
-- So the attack section 11 was written to stop has been live the whole time:
-- script id = 1, 2, 3 ... through PostgREST and harvest every decision ever
-- logged, including question text, dataset name, notes and the owner's name.
--
-- The rule this file follows from here on: REVOKE FROM PUBLIC first, then
-- GRANT explicitly to the roles that should have it. Revoking from a role
-- without revoking from PUBLIC is a no-op that reads like a fix.
-- ============================================================

REVOKE EXECUTE ON FUNCTION get_decision_by_id(BIGINT)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_outcome_for_decision(BIGINT) FROM PUBLIC, anon, authenticated;

-- Re-assert the intended grants on the supported RPCs, explicitly, so the
-- privilege each role holds is stated rather than inherited from a default.
REVOKE EXECUTE ON FUNCTION get_decision_by_public_id(TEXT)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_decision_by_public_id(TEXT)  TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION get_outcome_for_public_id(TEXT)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_outcome_for_public_id(TEXT)  TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION update_decision_choice(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_decision_choice(BIGINT, TEXT, TEXT, TEXT) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION log_decision_record(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION log_decision_record(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION log_outcome_record(TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION log_outcome_record(TEXT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO anon, authenticated;

-- rls_auto_enable(): section 11 revoked it from anon, authenticated AND public,
-- so that one was already correct. Restated here only for completeness.
REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- ── Verification — run these and read the output ────────────────────────────
-- Every row must show 'f' in the anon column.
SELECT
    f.fn,
    has_function_privilege('anon',          f.fn, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', f.fn, 'EXECUTE') AS auth_can_execute
FROM (VALUES
    ('get_decision_by_id(bigint)'),
    ('get_outcome_for_decision(bigint)'),
    ('consume_quota(text,int,int)'),
    ('prune_quota(int)')
) AS f(fn);
