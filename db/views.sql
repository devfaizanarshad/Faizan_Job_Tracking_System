BEGIN;

CREATE OR REPLACE VIEW v_top_25 AS
SELECT company_name, office_city, priority_tier, weighted_score,
       speed_to_interview, current_student_hiring, language_classification,
       work_model, target_status, why_it_fits, potential_concerns, careers_url
FROM employers
ORDER BY
  CASE priority_tier WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 WHEN 'WATCH' THEN 5 ELSE 6 END,
  weighted_score DESC, company_name
LIMIT 25;

CREATE OR REPLACE VIEW v_hamburg_targets AS
SELECT * FROM employers
WHERE geographic_zone = 3
ORDER BY weighted_score DESC, company_name;

CREATE OR REPLACE VIEW v_smaller_city_hidden_gems AS
SELECT * FROM employers
WHERE hidden_gem
  AND office_city NOT IN ('Lübeck','Hamburg')
ORDER BY weighted_score DESC, company_name;

CREATE OR REPLACE VIEW v_data_database_targets AS
SELECT * FROM employers
WHERE relevant_roles && ARRAY['Data Engineering','Business Intelligence','Backend']::TEXT[]
   OR known_technologies && ARRAY['PostgreSQL','SQL','ETL','Databases','Data','Spatial Databases']::TEXT[]
ORDER BY weighted_score DESC, company_name;

CREATE OR REPLACE VIEW v_student_hiring_machines AS
SELECT company_name, office_city, priority_tier, weighted_score,
       current_student_hiring, historical_student_hiring, student_hiring_score,
       student_hiring_evidence, careers_url
FROM employers
WHERE student_hiring_score >= 8
ORDER BY student_hiring_score DESC, weighted_score DESC, company_name;

DROP VIEW IF EXISTS v_current_opportunities;
CREATE VIEW v_current_opportunities AS
SELECT e.company_name, e.office_city, e.priority_tier, e.weighted_score,
       o.title, o.location, o.opportunity_type, o.role_family,
       o.language_requirement, o.work_model, o.technology_mentions,
       o.job_url, o.source_date, o.verified_at, o.relevance_note
FROM opportunities o JOIN employers e USING (employer_id)
WHERE o.status = 'LIVE'
ORDER BY e.weighted_score DESC, o.verified_at DESC;

CREATE OR REPLACE VIEW v_attack_now AS
SELECT e.company_name, e.office_city, e.priority_tier, e.weighted_score,
       e.speed_to_interview, e.why_it_fits, e.potential_concerns,
       o.title, o.language_requirement, o.work_model, o.job_url
FROM employers e
LEFT JOIN opportunities o ON o.employer_id = e.employer_id AND o.status = 'LIVE'
WHERE e.target_status = 'ATTACK_NOW'
ORDER BY e.weighted_score DESC, o.verified_at DESC NULLS LAST;

COMMIT;
