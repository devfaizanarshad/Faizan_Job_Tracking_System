BEGIN;

CREATE TABLE IF NOT EXISTS opportunity_score_history (
  score_history_id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  model_version TEXT NOT NULL REFERENCES ranking_model_versions(model_version),
  profile_hash TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latent_fit_score NUMERIC(5,2) NOT NULL,
  actionability_score NUMERIC(5,2) NOT NULL,
  overall_score NUMERIC(5,2) NOT NULL,
  score_state_hash TEXT NOT NULL,
  UNIQUE(opportunity_id,model_version,profile_hash,score_state_hash)
);

CREATE TABLE IF NOT EXISTS opportunity_lifecycles (
  opportunity_id BIGINT PRIMARY KEY REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  official_posted_date DATE,
  official_deadline DATE,
  first_confirmed_live_at TIMESTAMPTZ,
  last_confirmed_live_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  monitoring_observations INTEGER NOT NULL DEFAULT 0,
  material_changes INTEGER NOT NULL DEFAULT 0,
  observed_lifetime_days NUMERIC(8,2),
  lifetime_confidence TEXT NOT NULL CHECK(lifetime_confidence IN ('KNOWN','OBSERVED','UNKNOWN','INSUFFICIENT_DATA')),
  posting_date_status TEXT NOT NULL CHECK(posting_date_status IN ('KNOWN','OBSERVED','UNKNOWN','INSUFFICIENT_DATA')),
  closure_evidence_valid BOOLEAN NOT NULL DEFAULT FALSE,
  role_classification TEXT NOT NULL,
  role_families TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  language_category TEXT NOT NULL,
  language_evidence TEXT,
  work_mode TEXT,
  location TEXT,
  latent_fit_history JSONB NOT NULL DEFAULT '[]'::JSONB,
  actionability_history JSONB NOT NULL DEFAULT '[]'::JSONB,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunity_role_families (
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  role_family TEXT NOT NULL CHECK(role_family IN (
    'BACKEND','FULLSTACK','FRONTEND','DATA_ENGINEERING','DATA_ANALYTICS','DATABASE',
    'GIS_GEOSPATIAL','SECURITY','APPSEC','DEVSECOPS','CLOUD_DEVOPS','QA_AUTOMATION',
    'AI_ML','TECHNICAL_SUPPORT','PRODUCT_TECHNICAL','RESEARCH_HIWI','OTHER'
  )),
  evidence TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('KNOWN','OBSERVED','UNKNOWN','INSUFFICIENT_DATA')),
  PRIMARY KEY(opportunity_id,role_family)
);

CREATE TABLE IF NOT EXISTS language_evidence_observations (
  language_observation_id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  snapshot_id BIGINT REFERENCES opportunity_snapshots(snapshot_id) ON DELETE CASCADE,
  language_category TEXT NOT NULL,
  exact_evidence TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  evidence_hash TEXT NOT NULL,
  UNIQUE(opportunity_id,snapshot_id,evidence_hash)
);

CREATE TABLE IF NOT EXISTS employer_historical_metrics (
  employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
  total_unique_opportunities INTEGER NOT NULL,
  relevant_opportunities INTEGER NOT NULL,
  strong_excellent_matches INTEGER NOT NULL,
  student_opportunities INTEGER NOT NULL,
  werkstudent_opportunities INTEGER NOT NULL,
  hiwi_research_opportunities INTEGER NOT NULL,
  internship_thesis_opportunities INTEGER NOT NULL,
  backend_roles INTEGER NOT NULL,
  fullstack_roles INTEGER NOT NULL,
  data_database_roles INTEGER NOT NULL,
  gis_roles INTEGER NOT NULL,
  security_roles INTEGER NOT NULL,
  cloud_devops_roles INTEGER NOT NULL,
  explicit_english_opportunities INTEGER NOT NULL,
  german_required_opportunities INTEGER NOT NULL,
  enrollment_required_opportunities INTEGER NOT NULL,
  remote_hybrid_opportunities INTEGER NOT NULL,
  median_confident_lifetime_days NUMERIC(8,2),
  lifetime_metric_status TEXT NOT NULL,
  most_recent_relevant_at TIMESTAMPTZ,
  relevant_first_seen_30d INTEGER NOT NULL,
  relevant_first_seen_60d INTEGER NOT NULL,
  relevant_first_seen_90d INTEGER NOT NULL,
  official_postings_30d INTEGER NOT NULL,
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  observation_span_days INTEGER NOT NULL DEFAULT 0,
  source_success_ratio NUMERIC(5,4),
  confidence TEXT NOT NULL CHECK(confidence IN ('INSUFFICIENT_DATA','LOW','MEDIUM','HIGH')),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employer_intelligence_scores (
  employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
  employer_activity_score NUMERIC(5,2) NOT NULL CHECK(employer_activity_score BETWEEN 0 AND 100),
  employer_fit_score NUMERIC(5,2) NOT NULL CHECK(employer_fit_score BETWEEN 0 AND 100),
  faizan_opportunity_history_score NUMERIC(5,2) NOT NULL CHECK(faizan_opportunity_history_score BETWEEN 0 AND 100),
  watch_priority_score NUMERIC(5,2) NOT NULL CHECK(watch_priority_score BETWEEN 0 AND 100),
  activity_components JSONB NOT NULL,
  fit_components JSONB NOT NULL,
  watch_components JSONB NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('INSUFFICIENT_DATA','LOW','MEDIUM','HIGH')),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employer_language_intelligence (
  employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
  relevant_vacancies_observed INTEGER NOT NULL,
  explicit_english_roles INTEGER NOT NULL,
  english_required_roles INTEGER NOT NULL,
  german_required_roles INTEGER NOT NULL,
  strongest_german_threshold TEXT,
  student_roles_with_english_evidence INTEGER NOT NULL,
  observation_statement TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('INSUFFICIENT_DATA','LOW','MEDIUM','HIGH')),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technology_demand_history (
  technology TEXT PRIMARY KEY,
  total_observed_mentions INTEGER NOT NULL,
  distinct_opportunities INTEGER NOT NULL,
  distinct_employers INTEGER NOT NULL,
  student_role_opportunities INTEGER NOT NULL,
  strong_match_opportunities INTEGER NOT NULL,
  first_observed_30d INTEGER NOT NULL,
  first_observed_60d INTEGER NOT NULL,
  first_observed_90d INTEGER NOT NULL,
  evidence_status TEXT NOT NULL CHECK(evidence_status IN ('KNOWN','OBSERVED','UNKNOWN','INSUFFICIENT_DATA')),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employer_trend_observations (
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  trend_type TEXT NOT NULL,
  observed_statement TEXT NOT NULL,
  current_count INTEGER NOT NULL,
  prior_count INTEGER,
  direction TEXT NOT NULL CHECK(direction IN ('INCREASING','DECREASING','STABLE','REPEATED','INSUFFICIENT_DATA')),
  confidence TEXT NOT NULL CHECK(confidence IN ('INSUFFICIENT_DATA','LOW','MEDIUM','HIGH')),
  evidence JSONB NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(employer_id,trend_type)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  market_snapshot_id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observation_period_start TIMESTAMPTZ,
  observation_period_end TIMESTAMPTZ,
  total_live_opportunities INTEGER NOT NULL,
  relevant_live_opportunities INTEGER NOT NULL,
  strong_live_opportunities INTEGER NOT NULL,
  student_live_opportunities INTEGER NOT NULL,
  snapshot_payload JSONB NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshot_employers (
  market_snapshot_id BIGINT NOT NULL REFERENCES market_snapshots(market_snapshot_id) ON DELETE CASCADE,
  employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
  relevant_live_opportunities INTEGER NOT NULL,
  activity_score NUMERIC(5,2),
  fit_history_score NUMERIC(5,2),
  watch_priority_score NUMERIC(5,2),
  PRIMARY KEY(market_snapshot_id,employer_id)
);

CREATE TABLE IF NOT EXISTS market_snapshot_role_families (
  market_snapshot_id BIGINT NOT NULL REFERENCES market_snapshots(market_snapshot_id) ON DELETE CASCADE,
  role_family TEXT NOT NULL,
  live_opportunities INTEGER NOT NULL,
  PRIMARY KEY(market_snapshot_id,role_family)
);

CREATE TABLE IF NOT EXISTS market_snapshot_technologies (
  market_snapshot_id BIGINT NOT NULL REFERENCES market_snapshots(market_snapshot_id) ON DELETE CASCADE,
  technology TEXT NOT NULL,
  live_opportunities INTEGER NOT NULL,
  PRIMARY KEY(market_snapshot_id,technology)
);

CREATE OR REPLACE VIEW v_employer_hiring_history AS
SELECT e.company_name,m.* FROM employer_historical_metrics m JOIN employers e USING(employer_id)
ORDER BY m.relevant_opportunities DESC,e.company_name;

CREATE OR REPLACE VIEW v_employer_activity AS
SELECT e.company_name,s.employer_activity_score,s.activity_components,s.confidence,m.observation_span_days,m.source_success_ratio
FROM employer_intelligence_scores s JOIN employer_historical_metrics m USING(employer_id) JOIN employers e USING(employer_id)
ORDER BY s.employer_activity_score DESC,e.company_name;

CREATE OR REPLACE VIEW v_employer_faizan_fit_history AS
SELECT e.company_name,s.employer_fit_score,s.faizan_opportunity_history_score,s.fit_components,s.confidence
FROM employer_intelligence_scores s JOIN employers e USING(employer_id)
ORDER BY s.faizan_opportunity_history_score DESC,e.company_name;

CREATE OR REPLACE VIEW v_employer_watch_priority AS
SELECT e.company_name,s.watch_priority_score,s.watch_components,s.employer_activity_score,s.employer_fit_score,
       s.faizan_opportunity_history_score,s.confidence
FROM employer_intelligence_scores s JOIN employers e USING(employer_id)
ORDER BY s.watch_priority_score DESC,e.company_name;

CREATE OR REPLACE VIEW v_role_family_trends AS
SELECT rf.role_family,count(DISTINCT rf.opportunity_id) opportunities,count(DISTINCT o.employer_id) employers,
  count(DISTINCT o.location) FILTER(WHERE o.location IS NOT NULL) cities,
  count(DISTINCT rf.opportunity_id) FILTER(WHERE lc.role_classification<>'FULL_TIME') student_opportunities,
  count(DISTINCT rf.opportunity_id) FILTER(WHERE r.latent_fit_score>=70) strong_faizan_matches,
  count(DISTINCT rf.opportunity_id) FILTER(WHERE lc.language_category='EXPLICIT_ENGLISH_OK') explicit_english_opportunities,
  min(lc.first_seen_at) first_observed_at,max(lc.last_seen_at) last_observed_at,
  CASE WHEN count(DISTINCT rf.opportunity_id)>=10 AND max(lc.last_seen_at)-min(lc.first_seen_at)>=interval '90 days' THEN 'HIGH'
       WHEN count(DISTINCT rf.opportunity_id)>=6 AND max(lc.last_seen_at)-min(lc.first_seen_at)>=interval '30 days' THEN 'MEDIUM'
       WHEN count(DISTINCT rf.opportunity_id)>=3 AND max(lc.last_seen_at)-min(lc.first_seen_at)>=interval '14 days' THEN 'LOW'
       ELSE 'INSUFFICIENT_DATA' END confidence
FROM opportunity_role_families rf JOIN opportunities o USING(opportunity_id)
JOIN opportunity_lifecycles lc USING(opportunity_id) LEFT JOIN opportunity_rankings r USING(opportunity_id)
WHERE o.alert_class<>'NOT_RELEVANT' GROUP BY rf.role_family ORDER BY opportunities DESC,rf.role_family;

CREATE OR REPLACE VIEW v_technology_demand AS
SELECT * FROM technology_demand_history ORDER BY distinct_opportunities DESC,technology;

CREATE OR REPLACE VIEW v_language_intelligence AS
SELECT e.company_name,l.* FROM employer_language_intelligence l JOIN employers e USING(employer_id)
ORDER BY l.explicit_english_roles DESC,l.relevant_vacancies_observed DESC,e.company_name;

CREATE OR REPLACE VIEW v_vacancy_lifetime AS
SELECT e.company_name,o.title,l.* FROM opportunity_lifecycles l JOIN opportunities o USING(opportunity_id)
JOIN employers e ON e.employer_id=l.employer_id ORDER BY l.closure_evidence_valid DESC,l.observed_lifetime_days DESC NULLS LAST;

CREATE OR REPLACE VIEW v_market_snapshot_latest AS
SELECT * FROM market_snapshots ORDER BY snapshot_date DESC LIMIT 1;

CREATE OR REPLACE VIEW v_insufficient_history AS
SELECT e.company_name,m.observation_span_days,m.total_unique_opportunities,m.relevant_opportunities,m.confidence,
  CASE WHEN m.observation_span_days<30 THEN 'Observation period under 30 days'
       WHEN m.relevant_opportunities<3 THEN 'Fewer than 3 relevant opportunities'
       ELSE 'Additional longitudinal evidence required' END reason
FROM employer_historical_metrics m JOIN employers e USING(employer_id)
WHERE m.confidence='INSUFFICIENT_DATA' ORDER BY e.company_name;

COMMIT;
