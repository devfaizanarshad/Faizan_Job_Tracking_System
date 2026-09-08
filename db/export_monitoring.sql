\set ON_ERROR_STOP on
\copy (SELECT * FROM monitoring_runs ORDER BY run_id) TO 'exports/monitoring_runs_2026-08-30.csv' CSV HEADER
\copy (SELECT ms.*,e.company_name,uu.unit_name FROM monitored_sources ms JOIN employers e USING(employer_id) LEFT JOIN university_units uu ON uu.unit_id=ms.university_unit_id ORDER BY ms.source_priority,e.company_name,ms.source_name) TO 'exports/monitored_sources_s_tier_2026-08-30.csv' CSV HEADER
\copy (SELECT * FROM v_best_current_monitored_matches) TO 'exports/monitored_current_opportunities_2026-08-30.csv' CSV HEADER
\copy (SELECT ev.*,e.company_name,o.title,o.job_url FROM opportunity_change_events ev LEFT JOIN opportunities o USING(opportunity_id) LEFT JOIN employers e USING(employer_id) ORDER BY ev.event_id) TO 'exports/opportunity_change_events_2026-08-30.csv' CSV HEADER
\copy (SELECT mf.*,e.company_name,ms.source_name,ms.source_url FROM monitoring_fetches mf JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id) ORDER BY mf.fetch_id) TO 'exports/monitoring_fetches_2026-08-30.csv' CSV HEADER
\copy (SELECT p.*,e.company_name FROM recurring_hiring_patterns p JOIN employers e USING(employer_id) ORDER BY p.observation_count DESC,e.company_name) TO 'exports/recurring_hiring_patterns_2026-08-30.csv' CSV HEADER
