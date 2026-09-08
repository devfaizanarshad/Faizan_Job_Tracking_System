\set ON_ERROR_STOP on
\copy (SELECT * FROM opportunity_lifecycles ORDER BY opportunity_id) TO 'exports/phase2e_opportunity_lifecycles_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM v_employer_hiring_history) TO 'exports/phase2e_employer_hiring_history_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM v_employer_watch_priority) TO 'exports/phase2e_employer_watch_priority_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM v_role_family_trends) TO 'exports/phase2e_role_family_intelligence_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM v_technology_demand) TO 'exports/phase2e_technology_demand_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM v_language_intelligence) TO 'exports/phase2e_language_intelligence_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM employer_trend_observations ORDER BY employer_id,trend_type) TO 'exports/phase2e_trend_observations_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM market_snapshots ORDER BY snapshot_date) TO 'exports/phase2e_market_snapshots_2026-09-04.csv' CSV HEADER
