BEGIN;

CREATE TABLE IF NOT EXISTS employer_audits (
  employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
  audit_class TEXT NOT NULL CHECK (audit_class IN (
    'VERIFIED_HIGH_VALUE','VERIFIED_RELEVANT','PLAUSIBLE_BUT_NEEDS_RESEARCH','WEAK','REMOVE'
  )),
  technical_function_evidence SMALLINT NOT NULL CHECK (technical_function_evidence BETWEEN 0 AND 3),
  student_hiring_evidence_strength SMALLINT NOT NULL CHECK (student_hiring_evidence_strength BETWEEN 0 AND 3),
  language_evidence_strength SMALLINT NOT NULL CHECK (language_evidence_strength BETWEEN 0 AND 3),
  stack_evidence_strength SMALLINT NOT NULL CHECK (stack_evidence_strength BETWEEN 0 AND 3),
  source_quality SMALLINT NOT NULL CHECK (source_quality BETWEEN 0 AND 3),
  commute_class TEXT NOT NULL CHECK (commute_class IN (
    'EXCELLENT','EASY','REASONABLE','HYBRID_ONLY','STRETCH','NOT_PRACTICAL'
  )),
  monitoring_tier TEXT NOT NULL CHECK (monitoring_tier IN ('S','A','B','C','ARCHIVE')),
  recommended_action TEXT NOT NULL CHECK (recommended_action IN (
    'APPLY_NOW','PREPARE_FOR_APPLICATION','MONITOR_DAILY','MONITOR_WEEKLY','INVESTIGATE','LOW_PRIORITY'
  )),
  false_positive_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  false_negative_found BOOLEAN NOT NULL DEFAULT FALSE,
  time_value_judgment TEXT NOT NULL,
  audit_notes TEXT NOT NULL,
  audited_at DATE NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS verification_status TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS hours TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS missing_requirements TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS urgency TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_status_check DATE;

CREATE TABLE IF NOT EXISTS university_units (
  unit_id BIGSERIAL PRIMARY KEY,
  institution TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  research_focus TEXT NOT NULL,
  relevant_work TEXT NOT NULL,
  technologies TEXT[],
  student_route TEXT,
  current_opportunity TEXT,
  language_evidence TEXT,
  official_url TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','NEEDS_RESEARCH')),
  checked_at DATE NOT NULL,
  UNIQUE (institution, unit_name)
);

CREATE TABLE IF NOT EXISTS top20_rankings (
  rank SMALLINT PRIMARY KEY CHECK (rank BETWEEN 1 AND 20),
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  strongest_reason TEXT NOT NULL,
  strongest_match TEXT NOT NULL,
  biggest_obstacle TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  ranked_at DATE NOT NULL,
  UNIQUE (employer_id)
);

CREATE OR REPLACE VIEW v_audited_active_employers AS
SELECT e.*, a.audit_class, a.commute_class, a.monitoring_tier,
       a.recommended_action, a.time_value_judgment, a.audit_notes,
       a.false_positive_flags, a.false_negative_found
FROM employers e JOIN employer_audits a USING (employer_id)
WHERE a.audit_class NOT IN ('WEAK','REMOVE');

CREATE OR REPLACE VIEW v_quarantined_employers AS
SELECT e.company_name, e.office_city, e.priority_tier, e.weighted_score,
       a.audit_class, a.monitoring_tier, a.false_positive_flags,
       a.time_value_judgment, a.audit_notes
FROM employers e JOIN employer_audits a USING (employer_id)
WHERE a.audit_class IN ('WEAK','REMOVE');

CREATE OR REPLACE VIEW v_audited_top20 AS
SELECT t.rank, e.company_name, e.office_city, e.priority_tier,
       a.audit_class, a.commute_class, a.monitoring_tier,
       t.strongest_reason, t.strongest_match, e.student_hiring_evidence,
       e.language_classification, e.current_student_hiring,
       e.careers_url, t.biggest_obstacle, t.recommended_action
FROM top20_rankings t
JOIN employers e USING (employer_id)
JOIN employer_audits a USING (employer_id)
ORDER BY t.rank;

CREATE OR REPLACE VIEW v_verified_opportunities_right_now AS
SELECT e.company_name, o.title, o.opportunity_type, o.location,
       o.source_date, o.verification_status, o.job_url, o.role_family,
       o.language_requirement, o.technology_mentions, o.hours,
       o.missing_requirements, o.urgency, o.relevance_note
FROM opportunities o JOIN employers e USING (employer_id)
WHERE o.verification_status = 'LIVE_VERIFIED'
ORDER BY CASE o.urgency WHEN 'APPLY_IMMEDIATELY' THEN 1 WHEN 'APPLY_THIS_WEEK' THEN 2 ELSE 3 END,
         e.weighted_score DESC;

COMMIT;
