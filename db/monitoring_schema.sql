BEGIN;

CREATE TABLE IF NOT EXISTS monitoring_runs (
  run_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  run_mode TEXT NOT NULL CHECK (run_mode IN ('BASELINE','MANUAL','SCHEDULED','TEST')),
  requested_tiers TEXT[] NOT NULL DEFAULT ARRAY['S']::TEXT[],
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
  sources_attempted INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  opportunities_observed INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  tool_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitored_sources (
  monitored_source_id BIGSERIAL PRIMARY KEY,
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  university_unit_id BIGINT REFERENCES university_units(unit_id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'OFFICIAL_ATS','OFFICIAL_CAREERS','OFFICIAL_JOB_DETAIL','OFFICIAL_STUDENT_PAGE',
    'OFFICIAL_INSTITUTE_PAGE','OFFICIAL_RESOURCE'
  )),
  adapter TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  priority_tier TEXT NOT NULL CHECK (priority_tier IN ('S','A','B','C')),
  source_priority SMALLINT NOT NULL DEFAULT 1 CHECK (source_priority BETWEEN 1 AND 5),
  cadence_hours INTEGER NOT NULL CHECK (cadence_hours BETWEEN 1 AND 720),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  discovery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_content_hash TEXT,
  last_job_count INTEGER,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  next_check_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitored_sources_due
  ON monitored_sources(enabled,priority_tier,next_check_at);

-- One row per audited employer records whether trustworthy monitoring is
-- possible. This is deliberately separate from source health: an employer can
-- have a working careers page while its ATS is blocked or unparseable.
CREATE TABLE IF NOT EXISTS employer_monitoring_audits (
  employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
  monitoring_tier TEXT NOT NULL CHECK (monitoring_tier IN ('S','A','B','C')),
  careers_url TEXT,
  ats_name TEXT,
  ats_url TEXT,
  student_source_url TEXT,
  department_source_url TEXT,
  research_source_url TEXT,
  structured_feed_url TEXT,
  association_evidence TEXT NOT NULL,
  source_confidence TEXT NOT NULL CHECK (source_confidence IN ('HIGH','MEDIUM','LOW')),
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('SUCCESS','PARTIAL','UNMONITORABLE')),
  limitations TEXT,
  audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE monitored_sources ADD COLUMN IF NOT EXISTS source_confidence TEXT;
ALTER TABLE monitored_sources ADD COLUMN IF NOT EXISTS association_evidence TEXT;
ALTER TABLE monitored_sources ADD COLUMN IF NOT EXISTS monitoring_status TEXT;
ALTER TABLE monitored_sources ADD COLUMN IF NOT EXISTS limitation_note TEXT;

DO $$ BEGIN
  ALTER TABLE monitored_sources ADD CONSTRAINT monitored_sources_source_confidence_check
    CHECK (source_confidence IS NULL OR source_confidence IN ('HIGH','MEDIUM','LOW'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE monitored_sources ADD CONSTRAINT monitored_sources_monitoring_status_check
    CHECK (monitoring_status IS NULL OR monitoring_status IN ('ACTIVE','LIMITED','UNMONITORABLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS monitoring_fetches (
  fetch_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES monitoring_runs(run_id) ON DELETE CASCADE,
  monitored_source_id BIGINT NOT NULL REFERENCES monitored_sources(monitored_source_id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL,
  http_status INTEGER,
  effective_url TEXT,
  content_hash TEXT,
  content_length INTEGER,
  duration_ms INTEGER,
  etag TEXT,
  last_modified TEXT,
  jobs_found INTEGER,
  error_class TEXT,
  error_message TEXT,
  body_excerpt TEXT,
  UNIQUE(run_id,monitored_source_id)
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS application_deadline DATE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office_attendance TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS enrollment_requirement TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS expected_start_date TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS german_requirement_raw TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS english_requirement_raw TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS technical_requirements TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS preferred_requirements TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS role_description TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS eligibility_status TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS language_bucket TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS alert_class TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS latent_fit_class TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS monitoring_urgency TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS technical_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS domain_match_opportunity SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS professional_evidence_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS student_eligibility_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS language_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS location_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS start_date_match SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS niche_advantage SMALLINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS opportunity_priority NUMERIC(5,2);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS canonical_key TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_seen_run_id BIGINT REFERENCES monitoring_runs(run_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_canonical_key
  ON opportunities(canonical_key) WHERE canonical_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_monitoring_priority
  ON opportunities(verification_status,alert_class,opportunity_priority DESC);

CREATE TABLE IF NOT EXISTS opportunity_sources (
  opportunity_source_id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  monitored_source_id BIGINT REFERENCES monitored_sources(monitored_source_id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (source_role IN ('CANONICAL','SECONDARY','DISCOVERY')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_run_id BIGINT REFERENCES monitoring_runs(run_id) ON DELETE SET NULL,
  missed_runs INTEGER NOT NULL DEFAULT 0,
  is_current BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE opportunity_sources
  DROP CONSTRAINT IF EXISTS opportunity_sources_opportunity_id_source_url_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_source_observation
  ON opportunity_sources(opportunity_id,monitored_source_id,source_url);

CREATE TABLE IF NOT EXISTS opportunity_snapshots (
  snapshot_id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  run_id BIGINT NOT NULL REFERENCES monitoring_runs(run_id) ON DELETE CASCADE,
  monitored_source_id BIGINT REFERENCES monitored_sources(monitored_source_id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state_hash TEXT NOT NULL,
  description_hash TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE(opportunity_id,run_id,monitored_source_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_snapshots_latest
  ON opportunity_snapshots(opportunity_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_change_events (
  event_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES monitoring_runs(run_id) ON DELETE CASCADE,
  opportunity_id BIGINT REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  monitored_source_id BIGINT REFERENCES monitored_sources(monitored_source_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'BASELINE_OBSERVED','NEW_JOB','JOB_REMOVED','JOB_CLOSED','JOB_DESCRIPTION_CHANGED',
    'LANGUAGE_REQUIREMENT_CHANGED','DEADLINE_CHANGED','LOCATION_CHANGED',
    'WORK_MODE_CHANGED','STUDENT_ROLE_ADDED','CAREER_PAGE_CHANGED'
  )),
  previous_state JSONB,
  new_state JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_class TEXT,
  urgency TEXT,
  is_actionable BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(run_id,opportunity_id,monitored_source_id,event_type)
);

CREATE INDEX IF NOT EXISTS idx_change_events_recent
  ON opportunity_change_events(detected_at DESC,event_type);

CREATE TABLE IF NOT EXISTS recurring_hiring_patterns (
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  pattern_key TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  observed_months SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  recurring_titles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  recurring_departments TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  recurring_technologies TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  language_observations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  hours_observations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reopened_count INTEGER NOT NULL DEFAULT 0,
  prediction_status TEXT NOT NULL DEFAULT 'INSUFFICIENT_OBSERVATIONS',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(employer_id,pattern_key)
);

CREATE OR REPLACE VIEW v_monitoring_latest_run AS
SELECT * FROM monitoring_runs ORDER BY run_id DESC LIMIT 1;

CREATE OR REPLACE VIEW v_monitoring_new_since_last_check AS
SELECT ev.detected_at,ev.event_type,e.company_name,o.title,o.location,
       o.alert_class,o.latent_fit_class,o.eligibility_status,o.monitoring_urgency,
       o.opportunity_priority,o.job_url
FROM opportunity_change_events ev
LEFT JOIN opportunities o USING(opportunity_id)
LEFT JOIN employers e ON e.employer_id=o.employer_id
WHERE ev.run_id=(SELECT max(run_id) FROM monitoring_runs)
  AND ev.event_type IN ('NEW_JOB','STUDENT_ROLE_ADDED')
ORDER BY ev.is_actionable DESC,o.opportunity_priority DESC;

CREATE OR REPLACE VIEW v_best_current_monitored_matches AS
SELECT e.company_name,o.title,o.location,o.opportunity_type,o.verification_status,
       o.alert_class,o.latent_fit_class,o.eligibility_status,o.language_bucket,
       o.monitoring_urgency,o.opportunity_priority,o.hours,o.work_model,o.job_url,
       o.technical_match,o.domain_match_opportunity,o.professional_evidence_match,
       o.student_eligibility_match,o.language_match,o.location_match,
       o.start_date_match,o.niche_advantage,o.missing_requirements
FROM opportunities o JOIN employers e USING(employer_id)
WHERE o.verification_status IN ('LIVE_VERIFIED','EVERGREEN')
  AND o.last_seen_at IS NOT NULL
ORDER BY CASE o.alert_class WHEN 'EXCEPTIONAL_MATCH' THEN 1 WHEN 'STRONG_MATCH' THEN 2
         WHEN 'POSSIBLE_MATCH' THEN 3 WHEN 'MARKET_SIGNAL' THEN 4 ELSE 5 END,
         o.opportunity_priority DESC;

CREATE OR REPLACE VIEW v_monitoring_future_signals AS
SELECT e.company_name,o.title,o.location,o.latent_fit_class,o.eligibility_status,
       o.language_bucket,o.opportunity_priority,o.monitoring_urgency,o.job_url
FROM opportunities o JOIN employers e USING(employer_id)
WHERE o.verification_status IN ('LIVE_VERIFIED','EVERGREEN')
  AND o.eligibility_status IN ('LIKELY_ELIGIBLE_AFTER_ENROLLMENT','ENROLLMENT_REQUIRED','START_DATE_MISMATCH')
ORDER BY o.opportunity_priority DESC;

CREATE OR REPLACE VIEW v_monitoring_closed_since_last_check AS
SELECT ev.detected_at,e.company_name,o.title,ev.event_type,o.job_url
FROM opportunity_change_events ev
JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
WHERE ev.run_id=(SELECT max(run_id) FROM monitoring_runs)
  AND ev.event_type IN ('JOB_REMOVED','JOB_CLOSED')
ORDER BY ev.detected_at DESC;

CREATE OR REPLACE VIEW v_monitoring_high_value_page_changes AS
SELECT ev.detected_at,e.company_name,ms.source_name,ms.source_url,ev.event_type
FROM opportunity_change_events ev
JOIN monitored_sources ms USING(monitored_source_id)
JOIN employers e ON e.employer_id=ms.employer_id
WHERE ev.run_id=(SELECT max(run_id) FROM monitoring_runs)
  AND ev.event_type='CAREER_PAGE_CHANGED'
ORDER BY ev.detected_at DESC;

CREATE OR REPLACE VIEW v_monitoring_university_changes AS
SELECT ev.detected_at,uu.unit_name,ev.event_type,o.title,o.alert_class,
       o.eligibility_status,o.job_url
FROM opportunity_change_events ev
JOIN monitored_sources ms USING(monitored_source_id)
LEFT JOIN university_units uu ON uu.unit_id=ms.university_unit_id
LEFT JOIN opportunities o USING(opportunity_id)
WHERE ms.employer_id=12 AND ev.run_id=(SELECT max(run_id) FROM monitoring_runs)
ORDER BY ev.detected_at DESC;

COMMIT;
