BEGIN;

CREATE TABLE IF NOT EXISTS ranking_model_versions (
  model_version TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  latent_dimension_weights JSONB NOT NULL,
  actionability_rules JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS opportunity_rankings (
  opportunity_id BIGINT PRIMARY KEY REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  model_version TEXT NOT NULL REFERENCES ranking_model_versions(model_version),
  profile_hash TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latent_fit_score NUMERIC(5,2) NOT NULL CHECK(latent_fit_score BETWEEN 0 AND 100),
  market_intelligence_score NUMERIC(5,2) NOT NULL CHECK(market_intelligence_score BETWEEN 0 AND 100),
  actionability_score NUMERIC(5,2) NOT NULL CHECK(actionability_score BETWEEN 0 AND 100),
  overall_score NUMERIC(5,2) NOT NULL CHECK(overall_score BETWEEN 0 AND 100),
  primary_track TEXT NOT NULL,
  component_breakdown JSONB NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::JSONB,
  soft_gaps JSONB NOT NULL DEFAULT '[]'::JSONB,
  explanation JSONB NOT NULL,
  planning_scenario_profile JSONB NOT NULL,
  freshness_basis TEXT NOT NULL,
  first_seen_by_system TIMESTAMPTZ,
  official_posted_date DATE,
  is_officially_new BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE opportunity_rankings
  ADD COLUMN IF NOT EXISTS market_intelligence_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS planning_scenario_profile JSONB;
UPDATE opportunity_rankings SET market_intelligence_score=latent_fit_score
  WHERE market_intelligence_score IS NULL;
UPDATE opportunity_rankings SET planning_scenario_profile='{}'::JSONB
  WHERE planning_scenario_profile IS NULL;
ALTER TABLE opportunity_rankings
  ALTER COLUMN market_intelligence_score SET NOT NULL,
  ALTER COLUMN planning_scenario_profile SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='opportunity_rankings_market_intelligence_ck' AND conrelid='opportunity_rankings'::regclass) THEN
    ALTER TABLE opportunity_rankings ADD CONSTRAINT opportunity_rankings_market_intelligence_ck
      CHECK(market_intelligence_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_opportunity_rankings_latent
  ON opportunity_rankings(latent_fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_rankings_market
  ON opportunity_rankings(market_intelligence_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_rankings_actionable
  ON opportunity_rankings(actionability_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_rankings_track
  ON opportunity_rankings(primary_track,latent_fit_score DESC);

CREATE TABLE IF NOT EXISTS ranking_scenario_results (
  scenario_name TEXT NOT NULL CHECK(scenario_name IN ('CURRENT','PLANNING','ARRIVED','ENROLLED_B1','ENROLLED_B2')),
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  model_version TEXT NOT NULL REFERENCES ranking_model_versions(model_version),
  scenario_profile JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latent_fit_score NUMERIC(5,2) NOT NULL CHECK(latent_fit_score BETWEEN 0 AND 100),
  actionability_score NUMERIC(5,2) NOT NULL CHECK(actionability_score BETWEEN 0 AND 100),
  overall_score NUMERIC(5,2) NOT NULL CHECK(overall_score BETWEEN 0 AND 100),
  primary_track TEXT NOT NULL,
  component_breakdown JSONB NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]'::JSONB,
  soft_gaps JSONB NOT NULL DEFAULT '[]'::JSONB,
  explanation JSONB NOT NULL,
  PRIMARY KEY(scenario_name,opportunity_id,model_version)
);

DO $$
DECLARE constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name FROM pg_constraint c
  WHERE c.conrelid='ranking_scenario_results'::regclass AND c.contype='c'
    AND pg_get_constraintdef(c.oid) LIKE '%scenario_name%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ranking_scenario_results DROP CONSTRAINT %I',constraint_name);
  END IF;
  ALTER TABLE ranking_scenario_results ADD CONSTRAINT ranking_scenario_results_scenario_name_ck
    CHECK(scenario_name IN ('CURRENT','PLANNING','ARRIVED','ENROLLED_B1','ENROLLED_B2'));
END $$;

CREATE OR REPLACE VIEW v_ranked_live_opportunities AS
SELECT r.opportunity_id,r.model_version,r.profile_hash,r.calculated_at,r.latent_fit_score,
       r.actionability_score,r.overall_score,r.primary_track,r.component_breakdown,r.blockers,
       r.soft_gaps,r.explanation,r.freshness_basis,r.first_seen_by_system,r.official_posted_date,
       r.is_officially_new,o.title,o.location,o.opportunity_type,o.language_bucket,o.job_url,e.company_name,
       r.market_intelligence_score,r.planning_scenario_profile
FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT';

CREATE OR REPLACE VIEW v_top_current_actionable AS
SELECT * FROM v_ranked_live_opportunities
WHERE actionability_score>0
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(blockers) b WHERE b->>'severity' IN ('HARD','TEMPORARY'))
ORDER BY actionability_score DESC,latent_fit_score DESC,opportunity_id;

CREATE OR REPLACE VIEW v_top_future AS
SELECT * FROM v_ranked_live_opportunities
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(blockers) b WHERE b->>'severity' IN ('HARD','TEMPORARY'))
ORDER BY latent_fit_score DESC,actionability_score DESC,opportunity_id;

CREATE OR REPLACE VIEW v_top_10_overall AS
SELECT * FROM v_ranked_live_opportunities
ORDER BY market_intelligence_score DESC,latent_fit_score DESC,opportunity_id LIMIT 10;

CREATE OR REPLACE VIEW v_top_backend AS
SELECT * FROM v_ranked_live_opportunities WHERE component_breakdown->'tracks' ? 'BACKEND_SOFTWARE'
ORDER BY latent_fit_score DESC,actionability_score DESC;
CREATE OR REPLACE VIEW v_top_data AS
SELECT * FROM v_ranked_live_opportunities WHERE component_breakdown->'tracks' ? 'DATA_DATABASE'
ORDER BY latent_fit_score DESC,actionability_score DESC;
CREATE OR REPLACE VIEW v_top_gis AS
SELECT * FROM v_ranked_live_opportunities WHERE component_breakdown->'tracks' ? 'GIS_GEOSPATIAL'
ORDER BY latent_fit_score DESC,actionability_score DESC;
CREATE OR REPLACE VIEW v_top_security AS
SELECT * FROM v_ranked_live_opportunities WHERE component_breakdown->'tracks' ? 'SECURITY_APPSEC'
ORDER BY latent_fit_score DESC,actionability_score DESC;
CREATE OR REPLACE VIEW v_top_student AS
SELECT r.opportunity_id,r.model_version,r.profile_hash,r.calculated_at,r.latent_fit_score,
       r.actionability_score,r.overall_score,r.primary_track,r.component_breakdown,r.blockers,
       r.soft_gaps,r.explanation,r.freshness_basis,r.first_seen_by_system,r.official_posted_date,
       r.is_officially_new,o.title,o.location,o.opportunity_type,o.language_bucket,o.job_url,e.company_name,
       r.market_intelligence_score,r.planning_scenario_profile
FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT'
  AND (o.opportunity_type~*'Werkstudent|Working Student|Students?|Student Assistant|HiWi|Internship|Praktikum|Thesis|Abschlussarbeit'
       OR o.enrollment_requirement IS NOT NULL)
ORDER BY r.latent_fit_score DESC,r.actionability_score DESC;
CREATE OR REPLACE VIEW v_top_english_friendly AS
SELECT r.opportunity_id,r.model_version,r.profile_hash,r.calculated_at,r.latent_fit_score,
       r.actionability_score,r.overall_score,r.primary_track,r.component_breakdown,r.blockers,
       r.soft_gaps,r.explanation,r.freshness_basis,r.first_seen_by_system,r.official_posted_date,
       r.is_officially_new,o.title,o.location,o.opportunity_type,o.language_bucket,o.job_url,e.company_name,
       r.market_intelligence_score,r.planning_scenario_profile
FROM opportunity_rankings r JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT'
  AND o.language_bucket='ENGLISH_EXPLICITLY_ACCEPTED'
ORDER BY r.market_intelligence_score DESC,r.actionability_score DESC;

COMMIT;
