BEGIN;

CREATE TABLE IF NOT EXISTS import_employer_payloads (payload JSONB NOT NULL);

CREATE OR REPLACE FUNCTION jsonb_text_array(input JSONB)
RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
  FROM jsonb_array_elements_text(COALESCE(input, '[]'::JSONB));
$$;

INSERT INTO employers (
  company_name, legal_name, official_website, careers_url, job_search_url,
  office_city, geographic_zone, commute_category, train_minutes_estimate,
  transfers_estimate, commute_practicality_note, industry, sub_industry,
  company_type, company_size, what_they_do, international_presence,
  relevant_engineering_areas, relevant_roles, known_technologies,
  technology_evidence, relevant_departments, current_student_hiring,
  historical_student_hiring, student_hiring_evidence, language_classification,
  language_evidence, work_model, office_frequency, ats, job_alert_available,
  speculative_application, student_careers_page, university_connection,
  domain_match, profile_fit_score, student_hiring_score, language_score,
  commute_score, stack_match_score, domain_match_score,
  hidden_opportunity_score, speed_to_interview, speed_reason, priority_tier,
  target_status, hidden_gem, potentially_lower_competition, why_it_fits,
  potential_concerns, current_relevant_jobs, confidence,
  fact_inference_status, discovered_at, verified_at
)
SELECT
  p->>'n', p->>'legal', p->>'w', p->>'c', COALESCE(p->>'jobs', p->>'c'),
  p->>'city', (p->>'z')::SMALLINT, p->>'comm', NULLIF(p->>'mins','')::SMALLINT,
  COALESCE(NULLIF(p->>'tr','')::SMALLINT, 0), p->>'commnote', p->>'ind', p->>'sub',
  p->>'type', p->>'size', p->>'do', p->>'intl',
  jsonb_text_array(p->'areas'), jsonb_text_array(p->'roles'), jsonb_text_array(p->'tech'),
  p->>'te', jsonb_text_array(p->'deps'), COALESCE(p->>'cur','Unknown'),
  COALESCE(p->>'hist','Unknown'), p->>'se', COALESCE(p->>'lang','Unknown'),
  p->>'le', COALESCE(p->>'work','Unknown'), p->>'freq', p->>'ats',
  NULLIF(p->>'alert','')::BOOLEAN, NULLIF(p->>'spec','')::BOOLEAN,
  NULLIF(p->>'studentpage','')::BOOLEAN, p->>'uni', p->>'domain',
  (p->'sc'->>0)::SMALLINT, (p->'sc'->>1)::SMALLINT, (p->'sc'->>2)::SMALLINT,
  (p->'sc'->>3)::SMALLINT, (p->'sc'->>4)::SMALLINT, (p->'sc'->>5)::SMALLINT,
  (p->'sc'->>6)::SMALLINT, COALESCE(p->>'speed','Unknown'), p->>'sr',
  p->>'tier', COALESCE(p->>'ts','MONITOR'), COALESCE((p->>'hg')::BOOLEAN,FALSE),
  COALESCE((p->>'plc')::BOOLEAN,FALSE), p->>'why', p->>'conc', p->>'live',
  p->>'conf', p->>'fi', DATE '2026-08-30', DATE '2026-08-30'
FROM import_employer_payloads i
CROSS JOIN LATERAL (SELECT i.payload AS p) q
ON CONFLICT (company_name) DO UPDATE SET
  careers_url = EXCLUDED.careers_url,
  job_search_url = EXCLUDED.job_search_url,
  current_student_hiring = EXCLUDED.current_student_hiring,
  historical_student_hiring = EXCLUDED.historical_student_hiring,
  student_hiring_evidence = EXCLUDED.student_hiring_evidence,
  language_classification = EXCLUDED.language_classification,
  language_evidence = EXCLUDED.language_evidence,
  work_model = EXCLUDED.work_model,
  current_relevant_jobs = EXCLUDED.current_relevant_jobs,
  confidence = EXCLUDED.confidence,
  fact_inference_status = EXCLUDED.fact_inference_status,
  verified_at = EXCLUDED.verified_at,
  last_researched_at = NOW();

INSERT INTO sources (
  employer_id, source_url, source_type, source_title, claim_category,
  evidence_summary, evidence_status, checked_at, is_primary, is_stale
)
SELECT e.employer_id, p->>'source', COALESCE(p->>'stype','Official website'),
       p->>'stitle', COALESCE(p->>'claim','Employer discovery and relevance'),
       p->>'ssum', 'FACT', DATE '2026-08-30',
       COALESCE((p->>'primary')::BOOLEAN, TRUE), COALESCE((p->>'stale')::BOOLEAN,FALSE)
FROM import_employer_payloads i
JOIN employers e ON e.company_name = i.payload->>'n'
CROSS JOIN LATERAL (SELECT i.payload AS p) q
WHERE p->>'source' IS NOT NULL
ON CONFLICT (employer_id, source_url, claim_category) DO UPDATE SET
  evidence_summary = EXCLUDED.evidence_summary,
  checked_at = EXCLUDED.checked_at,
  is_stale = EXCLUDED.is_stale;

INSERT INTO research_queue (employer_id, next_action, research_gap, monitoring_cadence, next_check_date)
SELECT e.employer_id,
       CASE e.target_status
         WHEN 'ATTACK_NOW' THEN 'Review live role and tailor application immediately'
         WHEN 'SPECULATIVE' THEN 'Prepare targeted speculative application'
         WHEN 'RESEARCH_MORE' THEN 'Verify student hiring, language, and technical stack'
         ELSE 'Monitor careers page for technical student roles'
       END,
       CASE WHEN e.confidence = 'Low' THEN 'Low-confidence discovery record; needs official career and hiring verification'
            WHEN e.language_classification = 'Unknown' THEN 'Language requirement not yet verified'
            WHEN e.historical_student_hiring = 'Unknown' THEN 'Historical student hiring not yet verified'
            ELSE NULL END,
       CASE WHEN e.priority_tier IN ('S','A') THEN 'Weekly' WHEN e.priority_tier='B' THEN 'Biweekly' ELSE 'Monthly' END,
       CASE WHEN e.priority_tier IN ('S','A') THEN DATE '2026-09-06' WHEN e.priority_tier='B' THEN DATE '2026-09-13' ELSE DATE '2026-09-30' END
FROM employers e
ON CONFLICT (employer_id) DO UPDATE SET
  next_action = EXCLUDED.next_action,
  research_gap = EXCLUDED.research_gap,
  monitoring_cadence = EXCLUDED.monitoring_cadence,
  next_check_date = EXCLUDED.next_check_date;

TRUNCATE import_employer_payloads;
COMMIT;
