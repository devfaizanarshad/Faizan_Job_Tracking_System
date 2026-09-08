BEGIN;

CREATE TABLE IF NOT EXISTS employers (
    employer_id BIGSERIAL PRIMARY KEY,
    company_name TEXT NOT NULL UNIQUE,
    legal_name TEXT,
    official_website TEXT,
    careers_url TEXT,
    job_search_url TEXT,
    linkedin_url TEXT,
    office_city TEXT NOT NULL,
    office_address TEXT,
    geographic_zone SMALLINT NOT NULL CHECK (geographic_zone BETWEEN 1 AND 5),
    commute_category TEXT NOT NULL,
    train_minutes_estimate SMALLINT,
    transfers_estimate SMALLINT,
    commute_practicality_note TEXT,
    industry TEXT NOT NULL,
    sub_industry TEXT,
    company_type TEXT,
    company_size TEXT,
    what_they_do TEXT NOT NULL,
    international_presence TEXT,
    relevant_engineering_areas TEXT[],
    relevant_roles TEXT[],
    known_technologies TEXT[],
    technology_evidence TEXT,
    relevant_departments TEXT[],
    current_student_hiring TEXT NOT NULL DEFAULT 'Unknown',
    historical_student_hiring TEXT NOT NULL DEFAULT 'Unknown',
    student_hiring_evidence TEXT,
    language_classification TEXT NOT NULL DEFAULT 'Unknown',
    language_evidence TEXT,
    work_model TEXT NOT NULL DEFAULT 'Unknown',
    office_frequency TEXT,
    ats TEXT,
    job_alert_available BOOLEAN,
    speculative_application BOOLEAN,
    student_careers_page BOOLEAN,
    university_connection TEXT,
    domain_match TEXT,
    profile_fit_score SMALLINT CHECK (profile_fit_score BETWEEN 0 AND 10),
    student_hiring_score SMALLINT CHECK (student_hiring_score BETWEEN 0 AND 10),
    language_score SMALLINT CHECK (language_score BETWEEN 0 AND 10),
    commute_score SMALLINT CHECK (commute_score BETWEEN 0 AND 10),
    stack_match_score SMALLINT CHECK (stack_match_score BETWEEN 0 AND 10),
    domain_match_score SMALLINT CHECK (domain_match_score BETWEEN 0 AND 10),
    hidden_opportunity_score SMALLINT CHECK (hidden_opportunity_score BETWEEN 0 AND 10),
    speed_to_interview TEXT NOT NULL DEFAULT 'Unknown',
    speed_reason TEXT,
    priority_tier TEXT NOT NULL CHECK (priority_tier IN ('S','A','B','C','WATCH','LOW')),
    target_status TEXT NOT NULL DEFAULT 'MONITOR' CHECK (target_status IN ('ATTACK_NOW','MONITOR','SPECULATIVE','RESEARCH_MORE','LOW')),
    hidden_gem BOOLEAN NOT NULL DEFAULT FALSE,
    potentially_lower_competition BOOLEAN NOT NULL DEFAULT FALSE,
    why_it_fits TEXT NOT NULL,
    potential_concerns TEXT,
    current_relevant_jobs TEXT,
    confidence TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
    fact_inference_status TEXT NOT NULL,
    discovered_at DATE NOT NULL,
    verified_at DATE NOT NULL,
    last_researched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    weighted_score NUMERIC(4,2) GENERATED ALWAYS AS (
      ROUND((
        profile_fit_score * 0.20 +
        student_hiring_score * 0.18 +
        language_score * 0.12 +
        commute_score * 0.15 +
        stack_match_score * 0.15 +
        domain_match_score * 0.10 +
        hidden_opportunity_score * 0.10
      )::numeric, 2)
    ) STORED
);

CREATE TABLE IF NOT EXISTS sources (
    source_id BIGSERIAL PRIMARY KEY,
    employer_id BIGINT REFERENCES employers(employer_id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_title TEXT,
    claim_category TEXT NOT NULL,
    evidence_summary TEXT NOT NULL,
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('FACT','INFERENCE')),
    source_published_date DATE,
    checked_at DATE NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_stale BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (employer_id, source_url, claim_category)
);

CREATE TABLE IF NOT EXISTS opportunities (
    opportunity_id BIGSERIAL PRIMARY KEY,
    employer_id BIGINT NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    location TEXT,
    opportunity_type TEXT NOT NULL,
    role_family TEXT,
    status TEXT NOT NULL CHECK (status IN ('LIVE','HISTORICAL','CLOSED','UNKNOWN')),
    language_requirement TEXT,
    work_model TEXT,
    technology_mentions TEXT[],
    job_url TEXT NOT NULL,
    source_date DATE,
    verified_at DATE NOT NULL,
    relevance_note TEXT,
    UNIQUE (employer_id, title, job_url)
);

CREATE TABLE IF NOT EXISTS research_queue (
    employer_id BIGINT PRIMARY KEY REFERENCES employers(employer_id) ON DELETE CASCADE,
    next_action TEXT NOT NULL,
    research_gap TEXT,
    monitoring_cadence TEXT NOT NULL DEFAULT 'Monthly',
    next_check_date DATE,
    owner TEXT NOT NULL DEFAULT 'Faizan',
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Done','Paused'))
);

CREATE INDEX IF NOT EXISTS idx_employers_priority ON employers(priority_tier, weighted_score DESC);
CREATE INDEX IF NOT EXISTS idx_employers_city ON employers(office_city);
CREATE INDEX IF NOT EXISTS idx_employers_zone ON employers(geographic_zone);
CREATE INDEX IF NOT EXISTS idx_employers_tech ON employers USING GIN(known_technologies);
CREATE INDEX IF NOT EXISTS idx_employers_roles ON employers USING GIN(relevant_roles);
CREATE INDEX IF NOT EXISTS idx_sources_employer ON sources(employer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status, verified_at DESC);

CREATE OR REPLACE VIEW v_top_targets AS
SELECT company_name, office_city, priority_tier, weighted_score, speed_to_interview,
       current_student_hiring, language_classification, work_model, target_status,
       why_it_fits, potential_concerns, careers_url
FROM employers
WHERE priority_tier IN ('S','A')
ORDER BY CASE priority_tier WHEN 'S' THEN 1 ELSE 2 END, weighted_score DESC, company_name;

CREATE OR REPLACE VIEW v_luebeck_targets AS
SELECT * FROM employers
WHERE office_city IN ('Lübeck','Bad Schwartau','Stockelsdorf','Ratekau','Reinfeld','Bad Oldesloe','Ratzeburg','Mölln','Eutin','Lensahn','Groß Grönau')
ORDER BY geographic_zone, weighted_score DESC;

CREATE OR REPLACE VIEW v_current_opportunities AS
SELECT e.company_name, e.office_city, e.priority_tier, o.title, o.role_family,
       o.language_requirement, o.work_model, o.technology_mentions, o.job_url, o.verified_at
FROM opportunities o JOIN employers e USING (employer_id)
WHERE o.status = 'LIVE'
ORDER BY e.weighted_score DESC, o.verified_at DESC;

CREATE OR REPLACE VIEW v_high_value_monitoring AS
SELECT company_name, office_city, priority_tier, weighted_score, historical_student_hiring,
       current_student_hiring, target_status, why_it_fits, careers_url
FROM employers
WHERE profile_fit_score >= 7 AND stack_match_score >= 6
  AND historical_student_hiring IN ('Yes','Strong evidence')
  AND current_student_hiring <> 'Yes - relevant live role'
ORDER BY weighted_score DESC;

CREATE OR REPLACE VIEW v_hidden_gems AS
SELECT company_name, office_city, weighted_score, potentially_lower_competition,
       why_it_fits, potential_concerns, careers_url
FROM employers
WHERE hidden_gem
ORDER BY weighted_score DESC;

CREATE OR REPLACE VIEW v_backend_targets AS
SELECT * FROM employers
WHERE relevant_roles && ARRAY['Backend','Full Stack','Software Engineering','Data Engineering']::TEXT[]
ORDER BY weighted_score DESC;

CREATE OR REPLACE VIEW v_gis_targets AS
SELECT * FROM employers
WHERE relevant_roles && ARRAY['GIS','Geospatial','Location Intelligence','Mobility Software']::TEXT[]
   OR known_technologies && ARRAY['PostGIS','GIS','Geodata','Routing']::TEXT[]
ORDER BY weighted_score DESC;

CREATE OR REPLACE VIEW v_security_targets AS
SELECT * FROM employers
WHERE relevant_roles && ARRAY['IT Security','Cybersecurity','DevSecOps','IAM','Security Engineering']::TEXT[]
   OR relevant_engineering_areas && ARRAY['Security','Cloud Security','Secure Software']::TEXT[]
ORDER BY weighted_score DESC;

CREATE OR REPLACE VIEW v_english_b1_targets AS
SELECT * FROM employers
WHERE language_score >= 7
ORDER BY language_score DESC, weighted_score DESC;

CREATE OR REPLACE VIEW v_low_confidence_targets AS
SELECT company_name, office_city, priority_tier, weighted_score, potential_concerns,
       fact_inference_status, careers_url
FROM employers WHERE confidence = 'Low'
ORDER BY weighted_score DESC;

COMMIT;
