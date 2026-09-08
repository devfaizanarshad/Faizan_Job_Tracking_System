\set ON_ERROR_STOP on
\copy (SELECT * FROM monitoring_profile) TO 'exports/phase2c_profile_2026-08-31.csv' CSV HEADER
\copy (SELECT * FROM automation_executions ORDER BY automation_execution_id) TO 'exports/phase2c_automation_executions_2026-08-31.csv' CSV HEADER
\copy (SELECT ad.*,e.company_name,o.title,o.job_url FROM alert_decisions ad JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id) ORDER BY alert_id) TO 'exports/phase2c_alert_decisions_2026-08-31.csv' CSV HEADER
\copy (SELECT she.*,e.company_name,ms.source_name,ms.source_url FROM source_health_events she JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id) ORDER BY health_event_id) TO 'exports/phase2c_source_health_2026-08-31.csv' CSV HEADER
\copy (SELECT * FROM daily_digest_runs ORDER BY digest_date) TO 'exports/phase2c_daily_digest_runs_2026-08-31.csv' CSV HEADER
