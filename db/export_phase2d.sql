\set ON_ERROR_STOP on
\copy (SELECT r.*,e.company_name,o.title,o.job_url FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id) ORDER BY overall_score DESC) TO 'exports/phase2d_opportunity_rankings_2026-09-04.csv' CSV HEADER
\copy (SELECT s.*,e.company_name,o.title,o.job_url FROM ranking_scenario_results s JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id) ORDER BY scenario_name,overall_score DESC) TO 'exports/phase2d_scenario_results_2026-09-04.csv' CSV HEADER
\copy (SELECT * FROM ranking_model_versions ORDER BY created_at) TO 'exports/phase2d_model_versions_2026-09-04.csv' CSV HEADER
