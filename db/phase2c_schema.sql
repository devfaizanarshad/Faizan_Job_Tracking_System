BEGIN;

CREATE TABLE IF NOT EXISTS monitoring_profile (
  profile_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (profile_id),
  current_status TEXT NOT NULL DEFAULT 'Outside Germany',
  expected_move TEXT NOT NULL DEFAULT 'Germany',
  target_university TEXT NOT NULL DEFAULT 'Universität zu Lübeck',
  enrollment_status TEXT NOT NULL DEFAULT 'NOT_ENROLLED'
    CHECK (enrollment_status IN ('NOT_ENROLLED','APPLIED','ACCEPTED','ENROLLED')),
  german_level TEXT NOT NULL DEFAULT 'A2',
  target_german_level TEXT NOT NULL DEFAULT 'B1',
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO monitoring_profile(profile_id) VALUES(TRUE)
ON CONFLICT (profile_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS automation_executions (
  automation_execution_id BIGSERIAL PRIMARY KEY,
  scheduled_start TIMESTAMPTZ NOT NULL,
  actual_start TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  requested_tiers TEXT[] NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('MANUAL','SCHEDULED','TEST')),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED','RUNNING','SUCCEEDED','PARTIAL','FAILED','SKIPPED_OVERLAP')),
  monitoring_run_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  sources_attempted INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  opportunities_observed INTEGER NOT NULL DEFAULT 0,
  events_generated INTEGER NOT NULL DEFAULT 0,
  alerts_generated INTEGER NOT NULL DEFAULT 0,
  alerts_delivered INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_recent
  ON automation_executions(scheduled_start DESC,status);

CREATE TABLE IF NOT EXISTS alert_decisions (
  alert_id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES opportunity_change_events(event_id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  action TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  match_reasons JSONB NOT NULL DEFAULT '[]'::JSONB,
  material_fingerprint TEXT NOT NULL,
  rendered_content TEXT NOT NULL,
  alert_status TEXT NOT NULL DEFAULT 'STORED'
    CHECK (alert_status IN ('STORED','NOTIFIED','SUPPRESSED','ACKNOWLEDGED')),
  first_notified_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  notification_count INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,alert_type),
  UNIQUE(opportunity_id,alert_type,material_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_alert_decisions_priority_recent
  ON alert_decisions(priority,created_at DESC);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  delivery_id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES alert_decisions(alert_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('TERMINAL','MARKDOWN','EMAIL','TELEGRAM','DESKTOP')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('PREPARED','DELIVERED','SKIPPED','FAILED')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE(alert_id,channel)
);

CREATE TABLE IF NOT EXISTS source_health_events (
  health_event_id BIGSERIAL PRIMARY KEY,
  fetch_id BIGINT NOT NULL UNIQUE REFERENCES monitoring_fetches(fetch_id) ON DELETE CASCADE,
  monitored_source_id BIGINT NOT NULL REFERENCES monitored_sources(monitored_source_id) ON DELETE CASCADE,
  run_id BIGINT NOT NULL REFERENCES monitoring_runs(run_id) ON DELETE CASCADE,
  health_type TEXT NOT NULL CHECK (health_type IN (
    'SOURCE_DOWN','HTTP_403','HTTP_429','PARSER_FAILURE','TLS_FAILURE',
    'ATS_STRUCTURE_CHANGED','ZERO_RESULTS_ANOMALY'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  details TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_source_health_unresolved
  ON source_health_events(escalated,detected_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS daily_digest_runs (
  digest_id BIGSERIAL PRIMARY KEY,
  digest_date DATE NOT NULL,
  timezone TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  high_value_new_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  source_failure_count INTEGER NOT NULL DEFAULT 0,
  action_required BOOLEAN NOT NULL DEFAULT FALSE,
  output_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(digest_date,timezone)
);

CREATE OR REPLACE VIEW v_pending_high_priority_alerts AS
SELECT ad.*,o.title,o.job_url,e.company_name
FROM alert_decisions ad
JOIN opportunities o USING(opportunity_id)
JOIN employers e USING(employer_id)
WHERE ad.priority IN ('P0','P1') AND ad.alert_status='STORED'
ORDER BY CASE ad.priority WHEN 'P0' THEN 0 ELSE 1 END,ad.created_at;

COMMIT;
