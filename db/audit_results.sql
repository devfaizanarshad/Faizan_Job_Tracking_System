BEGIN;

-- Milestone-1 quality audit, checked 2026-08-30.  Records marked REMOVE remain
-- physically present only so the original research trail is reproducible; the
-- active views exclude them.
WITH classification(employer_id,audit_class) AS (
  VALUES
  (1,'VERIFIED_HIGH_VALUE'),(2,'VERIFIED_HIGH_VALUE'),(3,'VERIFIED_HIGH_VALUE'),
  (4,'VERIFIED_RELEVANT'),(5,'VERIFIED_RELEVANT'),(6,'VERIFIED_HIGH_VALUE'),
  (7,'VERIFIED_RELEVANT'),(8,'VERIFIED_RELEVANT'),(9,'VERIFIED_HIGH_VALUE'),
  (10,'VERIFIED_HIGH_VALUE'),(11,'VERIFIED_RELEVANT'),(12,'VERIFIED_HIGH_VALUE'),
  (13,'VERIFIED_HIGH_VALUE'),(14,'VERIFIED_HIGH_VALUE'),(15,'VERIFIED_RELEVANT'),
  (16,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(17,'VERIFIED_HIGH_VALUE'),(18,'VERIFIED_RELEVANT'),
  (19,'VERIFIED_HIGH_VALUE'),(20,'VERIFIED_RELEVANT'),(21,'VERIFIED_RELEVANT'),
  (22,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(23,'VERIFIED_RELEVANT'),(24,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (25,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(26,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(27,'WEAK'),
  (28,'WEAK'),(29,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(30,'VERIFIED_RELEVANT'),
  (31,'VERIFIED_HIGH_VALUE'),(32,'VERIFIED_HIGH_VALUE'),(33,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (34,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(35,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (36,'WEAK'),(37,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(38,'REMOVE'),
  (39,'VERIFIED_RELEVANT'),(40,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(41,'REMOVE'),
  (42,'REMOVE'),(43,'VERIFIED_RELEVANT'),(44,'VERIFIED_RELEVANT'),
  (45,'VERIFIED_RELEVANT'),(46,'VERIFIED_HIGH_VALUE'),(47,'REMOVE'),
  (48,'VERIFIED_HIGH_VALUE'),(49,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (50,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(51,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (52,'VERIFIED_RELEVANT'),(53,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (54,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(55,'VERIFIED_HIGH_VALUE'),
  (56,'VERIFIED_RELEVANT'),(57,'WEAK'),(58,'WEAK'),
  (59,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),(60,'WEAK'),(61,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (62,'WEAK'),(63,'VERIFIED_RELEVANT'),(64,'VERIFIED_RELEVANT'),
  (65,'VERIFIED_RELEVANT'),(66,'VERIFIED_RELEVANT'),(67,'VERIFIED_HIGH_VALUE'),
  (68,'VERIFIED_RELEVANT'),(69,'PLAUSIBLE_BUT_NEEDS_RESEARCH'),
  (70,'VERIFIED_RELEVANT'),(71,'VERIFIED_RELEVANT'),(72,'VERIFIED_RELEVANT'),
  (73,'VERIFIED_HIGH_VALUE'),(74,'VERIFIED_HIGH_VALUE'),(75,'VERIFIED_HIGH_VALUE'),
  (76,'VERIFIED_RELEVANT'),(77,'VERIFIED_HIGH_VALUE'),(78,'VERIFIED_HIGH_VALUE'),
  (79,'VERIFIED_RELEVANT'),(80,'VERIFIED_RELEVANT'),(81,'VERIFIED_HIGH_VALUE'),
  (82,'VERIFIED_RELEVANT'),(83,'VERIFIED_RELEVANT'),(84,'VERIFIED_HIGH_VALUE'),
  (85,'VERIFIED_HIGH_VALUE'),(86,'VERIFIED_RELEVANT'),(87,'VERIFIED_RELEVANT'),
  (88,'VERIFIED_HIGH_VALUE'),(89,'VERIFIED_RELEVANT'),(90,'VERIFIED_HIGH_VALUE'),
  (91,'VERIFIED_RELEVANT'),(92,'VERIFIED_RELEVANT'),(93,'VERIFIED_HIGH_VALUE'),
  (94,'VERIFIED_HIGH_VALUE'),(95,'VERIFIED_RELEVANT'),(96,'VERIFIED_RELEVANT'),
  (97,'VERIFIED_HIGH_VALUE'),(98,'VERIFIED_RELEVANT'),(99,'VERIFIED_RELEVANT'),
  (100,'PLAUSIBLE_BUT_NEEDS_RESEARCH')
), primary_source AS (
  SELECT DISTINCT ON (employer_id) employer_id,source_type,source_url,is_stale
  FROM sources ORDER BY employer_id,is_primary DESC,source_id
)
INSERT INTO employer_audits(
  employer_id,audit_class,technical_function_evidence,
  student_hiring_evidence_strength,language_evidence_strength,
  stack_evidence_strength,source_quality,commute_class,monitoring_tier,
  recommended_action,false_positive_flags,false_negative_found,
  time_value_judgment,audit_notes,audited_at)
SELECT e.employer_id,c.audit_class,
  CASE c.audit_class WHEN 'VERIFIED_HIGH_VALUE' THEN 3 WHEN 'VERIFIED_RELEVANT' THEN 2
       WHEN 'PLAUSIBLE_BUT_NEEDS_RESEARCH' THEN 1 WHEN 'WEAK' THEN 1 ELSE 0 END,
  CASE WHEN e.employer_id IN (1,2,3,5,6,7,12,31,44,75,81,85,86,87,89) THEN 3
       WHEN e.current_student_hiring ILIKE ANY(ARRAY['Yes%','%pathway%','Open%']) THEN 2
       WHEN e.historical_student_hiring ILIKE 'Yes%' THEN 2 ELSE 0 END,
  CASE WHEN e.employer_id IN (1,3,5,6,7,12,75,81,85,89) THEN 3
       WHEN e.language_evidence IS NOT NULL AND length(e.language_evidence) > 35 THEN 2 ELSE 0 END,
  CASE WHEN e.employer_id IN (1,2,3,4,6,7,13,17,19,23,31,32,55,63,67,75,81,84,85,88,89) THEN 3
       WHEN cardinality(e.known_technologies) >= 2 THEN 2
       WHEN cardinality(e.known_technologies) = 1 THEN 1 ELSE 0 END,
  CASE WHEN ps.source_type ILIKE '%job advertisement%' OR ps.source_type ILIKE '%ATS%' THEN 3
       WHEN ps.source_type ILIKE '%careers%' OR ps.source_type ILIKE '%company website%'
         OR ps.source_type ILIKE '%engineering%' OR ps.source_type ILIKE '%university%' THEN 2
       WHEN ps.source_type ILIKE '%job board%' THEN 1 ELSE 1 END,
  CASE WHEN e.geographic_zone=1 THEN 'EXCELLENT'
       WHEN e.office_city ILIKE '%Stockelsdorf%' OR e.office_city ILIKE '%Bad Schwartau%'
         OR e.office_city ILIKE '%Reinfeld%' THEN 'EASY'
       WHEN e.office_city ILIKE '%Ahrensburg%' OR e.office_city ILIKE '%Bad Oldesloe%' THEN 'REASONABLE'
       WHEN e.geographic_zone=3 AND e.work_model ILIKE '%hybrid%' THEN 'REASONABLE'
       WHEN e.geographic_zone=3 THEN 'HYBRID_ONLY'
       WHEN e.geographic_zone=4 AND e.work_model ILIKE '%hybrid%' THEN 'HYBRID_ONLY'
       WHEN e.geographic_zone=4 THEN 'STRETCH' ELSE 'NOT_PRACTICAL' END,
  CASE WHEN c.audit_class='REMOVE' OR c.audit_class='WEAK' THEN 'ARCHIVE'
       WHEN c.audit_class='VERIFIED_HIGH_VALUE' AND e.geographic_zone<=3 THEN 'A'
       WHEN c.audit_class='VERIFIED_HIGH_VALUE' THEN 'B'
       WHEN c.audit_class='VERIFIED_RELEVANT' AND e.geographic_zone<=2 THEN 'B'
       WHEN c.audit_class='VERIFIED_RELEVANT' THEN 'C' ELSE 'C' END,
  CASE WHEN e.employer_id IN (2,85) THEN 'APPLY_NOW'
       WHEN e.employer_id IN (1,3,6,12,31) THEN 'PREPARE_FOR_APPLICATION'
       WHEN c.audit_class='VERIFIED_HIGH_VALUE' AND e.geographic_zone<=2 THEN 'MONITOR_DAILY'
       WHEN c.audit_class IN ('VERIFIED_HIGH_VALUE','VERIFIED_RELEVANT') THEN 'MONITOR_WEEKLY'
       WHEN c.audit_class='PLAUSIBLE_BUT_NEEDS_RESEARCH' THEN 'INVESTIGATE' ELSE 'LOW_PRIORITY' END,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN e.current_student_hiring='Unknown' THEN 'STUDENT_HIRING_UNVERIFIED' END,
    CASE WHEN e.language_classification IN ('English Friendly','English Possible','B1 Likely Viable')
              AND (e.language_evidence IS NULL OR length(e.language_evidence)<35) THEN 'LANGUAGE_INFERENCE' END,
    CASE WHEN ps.source_type ILIKE '%event%' OR ps.source_type ILIKE '%cluster%'
              OR ps.source_type ILIKE '%city source%' OR ps.source_type ILIKE '%job board%' THEN 'WEAK_OR_INDIRECT_PRIMARY_SOURCE' END,
    CASE WHEN e.employer_id IN (38,41,42) THEN 'NOT_A_DIRECT_EMPLOYER_RECORD' END,
    CASE WHEN e.employer_id=47 THEN 'DUPLICATE_GROUP_ENTITY' END,
    CASE WHEN e.employer_id=3 THEN 'B1_FALSE_POSITIVE_C1_REQUIRED' END,
    CASE WHEN e.employer_id=4 THEN 'EXPIRED_JOB_DROVE_SCORE' END,
    CASE WHEN e.employer_id IN (75,83,84) THEN 'CLOSED_JOB_DROVE_SCORE' END
  ],NULL),
  e.employer_id IN (6,17,32,46,55,67,88),
  CASE c.audit_class WHEN 'VERIFIED_HIGH_VALUE' THEN 'Worth focused application or active monitoring time.'
       WHEN 'VERIFIED_RELEVANT' THEN 'Worth checking when a role matches; do not over-invest without a vacancy.'
       WHEN 'PLAUSIBLE_BUT_NEEDS_RESEARCH' THEN 'Spend time only on one targeted evidence check before monitoring.'
       WHEN 'WEAK' THEN 'Not worth active job-search time on current evidence.'
       ELSE 'Quarantined from the active employer universe.' END,
  concat(e.company_name, ': ',
    CASE c.audit_class
      WHEN 'VERIFIED_HIGH_VALUE' THEN 'genuine technical function and strategically strong profile/domain fit; priority still depends on live role and language.'
      WHEN 'VERIFIED_RELEVANT' THEN 'technical relevance is supportable, but student, language, or current-role evidence is incomplete.'
      WHEN 'PLAUSIBLE_BUT_NEEDS_RESEARCH' THEN 'plausible technical employer, but the stored source does not yet prove a realistic student route.'
      WHEN 'WEAK' THEN 'stored evidence is indirect, stale, or too assumption-heavy for action.'
      ELSE 'not a distinct actionable employer or duplicates a better parent/institute record.' END,
    ' Primary evidence: ',coalesce(ps.source_type,'none'),'.'),
  DATE '2026-08-30'
FROM employers e JOIN classification c USING(employer_id)
LEFT JOIN primary_source ps USING(employer_id)
ON CONFLICT (employer_id) DO UPDATE SET
  audit_class=EXCLUDED.audit_class,
  technical_function_evidence=EXCLUDED.technical_function_evidence,
  student_hiring_evidence_strength=EXCLUDED.student_hiring_evidence_strength,
  language_evidence_strength=EXCLUDED.language_evidence_strength,
  stack_evidence_strength=EXCLUDED.stack_evidence_strength,
  source_quality=EXCLUDED.source_quality,commute_class=EXCLUDED.commute_class,
  monitoring_tier=EXCLUDED.monitoring_tier,recommended_action=EXCLUDED.recommended_action,
  false_positive_flags=EXCLUDED.false_positive_flags,
  false_negative_found=EXCLUDED.false_negative_found,
  time_value_judgment=EXCLUDED.time_value_judgment,audit_notes=EXCLUDED.audit_notes,
  audited_at=EXCLUDED.audited_at;

-- Manual monitoring overrides for the very best and the quarantine set.
UPDATE employer_audits SET monitoring_tier='S' WHERE employer_id IN (1,2,3,6,12,85);
UPDATE employer_audits SET monitoring_tier='ARCHIVE',recommended_action='LOW_PRIORITY'
WHERE audit_class IN ('WEAK','REMOVE');

-- Correct claims contradicted by the fresh verification pass.
UPDATE employers SET language_classification='Strong German',
  language_evidence='FACT: current backend Werkstudent advert requires German C1 minimum.',
  potential_concerns='C1 German is a hard requirement; live backend stack is Python/PHP rather than Node.js/TypeScript.',
  current_relevant_jobs='Back-End Software Developer:in – Werkstudium in Lübeck (live; 10–20 h/week).',
  job_search_url='https://www.singular-it.de/jobs/stellenangebot/12/back-end-software-developer-in',
  verified_at='2026-08-30' WHERE employer_id=3;
UPDATE employers SET current_student_hiring='Historical role now closed',
  current_relevant_jobs='Indeed advert expired; no current official vacancy verified.',verified_at='2026-08-30'
  WHERE employer_id=4;
UPDATE employers SET current_student_hiring='Yes - internship/thesis software route live; prior Werkstudent role closed',
  current_relevant_jobs='Live R&D software internship/thesis route; former Python/HIL Werkstudent role is closed.',
  language_classification='Strong German',verified_at='2026-08-30' WHERE employer_id=1;
UPDATE employers SET language_classification='Strong German',
  language_evidence='FACT: live Helpdesk Digitale Schule advert requires German C1.',verified_at='2026-08-30'
  WHERE employer_id=7;
UPDATE employers SET current_student_hiring='Historical/closed relevant role',
  current_relevant_jobs='The stored IT-Security role returns 404 and is closed.',verified_at='2026-08-30'
  WHERE employer_id=75;
UPDATE employers SET current_student_hiring='Historical/closed relevant role',
  current_relevant_jobs='The stored Cybersecurity posting explicitly says it has closed.',verified_at='2026-08-30'
  WHERE employer_id=83;
UPDATE employers SET current_student_hiring='Historical/closed relevant role',
  current_relevant_jobs='GIS posting had application period ending 2026-04-02; monitor for recurrence.',verified_at='2026-08-30'
  WHERE employer_id=84;
UPDATE employers SET language_classification='English Friendly',
  language_evidence='FACT: live GIS role accepts good German OR English; English careers page and technical student role also live.',
  current_relevant_jobs='Two live roles: Geoinformatik/Informatik (15–20h, hybrid) and Mobile Ticketing (20h).',
  verified_at='2026-08-30' WHERE employer_id=85;

-- Recalibrate the originally over-broad hidden-gem tag.  This remains an
-- inference, but only records with a niche/regional angle and some actionable
-- technical evidence retain it.
UPDATE employers SET hidden_gem=FALSE;
UPDATE employers SET hidden_gem=TRUE,potentially_lower_competition=TRUE
WHERE employer_id IN (3,5,6,10,13,14,17,23,30,32,39,46,52,55,65,67,85,86,87,88,89,94);

-- Re-verified existing opportunities.
UPDATE opportunities SET
  verification_status = CASE opportunity_id
    WHEN 1 THEN 'CLOSED' WHEN 2 THEN 'LIVE_VERIFIED' WHEN 3 THEN 'LIVE_VERIFIED'
    WHEN 4 THEN 'CLOSED' WHEN 5 THEN 'LIVE_VERIFIED' WHEN 6 THEN 'LIVE_VERIFIED'
    WHEN 7 THEN 'EVERGREEN' WHEN 8 THEN 'LIVE_VERIFIED' WHEN 9 THEN 'STATUS_UNCERTAIN'
    WHEN 10 THEN 'LIVE_VERIFIED' WHEN 11 THEN 'STATUS_UNCERTAIN' WHEN 12 THEN 'CLOSED'
    WHEN 13 THEN 'STATUS_UNCERTAIN' WHEN 14 THEN 'STATUS_UNCERTAIN' WHEN 15 THEN 'CLOSED'
    WHEN 16 THEN 'CLOSED' WHEN 17 THEN 'LIVE_VERIFIED' WHEN 18 THEN 'EVERGREEN'
    WHEN 19 THEN 'LIVE_VERIFIED' END,
  last_status_check='2026-08-30',
  urgency = CASE opportunity_id
    WHEN 2 THEN 'APPLY_IMMEDIATELY' WHEN 17 THEN 'APPLY_IMMEDIATELY'
    WHEN 3 THEN 'RESEARCH_FIRST' WHEN 5 THEN 'RESEARCH_FIRST'
    WHEN 6 THEN 'APPLY_THIS_WEEK' WHEN 8 THEN 'RESEARCH_FIRST'
    WHEN 10 THEN 'APPLY_THIS_WEEK' WHEN 19 THEN 'RESEARCH_FIRST'
    ELSE 'RESEARCH_FIRST' END,
  hours = CASE opportunity_id WHEN 2 THEN 'Up to 20 h/week' WHEN 3 THEN '10–20 h/week'
    WHEN 8 THEN '20 h/week' WHEN 10 THEN '16–40 h/week' WHEN 17 THEN '15–20 h/week'
    WHEN 19 THEN '16–20 h/week' ELSE hours END,
  missing_requirements = CASE opportunity_id
    WHEN 2 THEN 'UX depth and Julia are gaps; Julia is only desirable. React/TypeScript is strong.'
    WHEN 3 THEN 'German C1 is a hard gap at expected B1; Python/PHP role stack differs from strongest Node stack.'
    WHEN 5 THEN 'Secure German and Microsoft/Linux support orientation; less software development.'
    WHEN 6 THEN 'Good German requested; thesis format may not match immediate Werkstudent need.'
    WHEN 8 THEN 'German C1 is a hard gap; role is helpdesk rather than software engineering.'
    WHEN 10 THEN 'Imaging/metrology domain experience is not demonstrated.'
    WHEN 17 THEN 'No material technical gap: direct GIS/PostGIS/data fit; must be enrolled and able to commute hybrid.'
    WHEN 19 THEN 'Sufficient German required; role is planning/GIS rather than software engineering.'
    ELSE missing_requirements END;

UPDATE opportunities SET
  language_requirement='German C1 minimum (explicit)',
  job_url='https://www.singular-it.de/jobs/stellenangebot/12/back-end-software-developer-in'
WHERE opportunity_id=3;
UPDATE opportunities SET language_requirement='Good German OR English (explicit)'
WHERE opportunity_id=17;
UPDATE opportunities SET language_requirement='Good German and English (explicit)'
WHERE opportunity_id=1;

-- Additional verified routes found during the audit (no new employers).
INSERT INTO opportunities(employer_id,title,location,opportunity_type,role_family,status,
  language_requirement,work_model,technology_mentions,job_url,source_date,verified_at,
  relevance_note,verification_status,hours,missing_requirements,urgency,last_status_check)
VALUES
 (1,'Praktikum / Abschlussarbeit in der Forschung und Entwicklung – Softwareentwicklung','Lübeck',
  'Internship / thesis','R&D Software','LIVE','Not explicitly stated','Hybrid possible',
  ARRAY['software development','frameworks','network technology'],
  'https://erecruitment.draeger.com/index.php?ac=jobad&id=12310',NULL,'2026-08-30',
  'Official evergreen-style R&D software route; substantial experience transfers, but 35 h/week makes it semester-break/thesis oriented.',
  'LIVE_VERIFIED','35 h/week','At least fourth semester; full-time intensity is not a normal semester Werkstudent schedule.','RESEARCH_FIRST','2026-08-30'),
 (85,'Werkstudent im Mobile Ticketing','Hamburg','Werkstudent','Software / Mobility','LIVE',
  'No explicit requirement; English version is complete','Flexible/hybrid wording',
  ARRAY['Docker','Spring Boot','AWS'],
  'https://hansecom.com/en/career/student-trainee-for-the-mobile-ticketing-team-mwd.html',NULL,'2026-08-30',
  'Mobility domain plus Docker/AWS and prior production engineering; less exact than the GIS role but still strong.',
  'LIVE_VERIFIED','20 h/week','Spring Boot/Java not demonstrated; role only asks first programming experience.','APPLY_IMMEDIATELY','2026-08-30'),
 (12,'HiWi – secure RISC-V processor','Lübeck','Student assistant','Security / Computer Engineering','LIVE',
  'English page available; no explicit CEFR requirement','On campus',ARRAY['RISC-V','secure processor architecture'],
  'https://www.iti.uni-luebeck.de/en/staff/christian-ewert-m-sc.html',NULL,'2026-08-30',
  'Direct MSc security alignment and unusually strong prior programming evidence; hardware architecture is a learning gap.',
  'LIVE_VERIFIED',NULL,'Embedded/hardware and RISC-V experience not demonstrated; university enrollment needed.','APPLY_THIS_WEEK','2026-08-30'),
 (12,'HiWi – Intelligent Systems Lab / Arrowhead Tools','Lübeck','Student assistant','Industrial IoT / Software','LIVE',
  'Advert in English','On campus',ARRAY['Java','Industrial IoT','Arrowhead Tools'],
  'https://www.iti.uni-luebeck.de/fileadmin/website/Mitarbeiter/Ghofrani/HiWi_UzL.pdf',NULL,'2026-08-30',
  'Production software, APIs and deployment transfer; technical topic is industrial IoT and role can be shaped to interests.',
  'LIVE_VERIFIED',NULL,'Java is requested and University of Lübeck enrollment is mandatory.','APPLY_THIS_WEEK','2026-08-30')
ON CONFLICT (employer_id,title,job_url) DO UPDATE SET
  verification_status=EXCLUDED.verification_status,verified_at=EXCLUDED.verified_at,
  last_status_check=EXCLUDED.last_status_check,urgency=EXCLUDED.urgency;

-- Keep the legacy coarse status aligned; verification_status is the detailed
-- authoritative field used by the audited views.
UPDATE opportunities SET status = CASE
  WHEN verification_status='CLOSED' THEN 'CLOSED'
  WHEN verification_status='STATUS_UNCERTAIN' THEN 'UNKNOWN'
  WHEN verification_status='HISTORICAL' THEN 'HISTORICAL'
  ELSE 'LIVE' END,
  verified_at='2026-08-30';

-- A seed-time check date is not a publication date. Clear it where the
-- official page does not state a posting date.
UPDATE opportunities SET source_date=NULL WHERE opportunity_id IN (1,3,4,5,6,7,9,10,11,13,14,17,18);
UPDATE opportunities SET source_date='2026-06-11' WHERE opportunity_id=8;

DELETE FROM top20_rankings;
INSERT INTO top20_rankings(rank,employer_id,strongest_reason,strongest_match,biggest_obstacle,recommended_action,ranked_at) VALUES
 (1,85,'Two live technical student roles and repeated student-to-employee evidence.','GeoFenceTrack PostGIS plus Chargerzilla maps/large geodata; Docker/AWS for mobile ticketing.','Hamburg commute; GIS role is prototyping/product work, not pure backend.','APPLY_NOW','2026-08-30'),
 (2,2,'Live local research-software role with React/TypeScript and flexible hours.','React/Next.js production work, testing, APIs, Python and databases.','UX emphasis; no explicit language evidence.','APPLY_NOW','2026-08-30'),
 (3,12,'Institute-level HiWi market has two verified live technical routes and recurring informal hiring.','MSc security plus programming, APIs, deployment and data experience.','Must be enrolled; Java/RISC-V are learning gaps.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (4,1,'Large local software/R&D organization with a live software internship route and recurring student formats.','Python, testing, Docker/deployment and upcoming security specialization.','Prior Werkstudent role closed; many roles need good German and/or embedded depth.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (5,6,'Official English student application route and extensive local AI/software organization.','Data pipelines, databases, imaging-adjacent data processing and production software.','Good German requested; no exact software Werkstudent opening today.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (6,3,'Local software/data consultancy with a genuinely broad, verified stack and live student role.','PostgreSQL/ETL, Next.js/React, Python, Docker, data and business workflows.','Current role requires German C1 and emphasizes Python/PHP.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (7,31,'Verified live 16–40 hour student research role at a software-enabled computer-vision employer.','Python/data processing/testing and strong general engineering maturity.','Imaging/metrology specialization and Ahrensburg commute.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (8,32,'Enterprise content/process software employer with established student pathways and close regional commute.','Digi2S workflows/RBAC plus SQL, APIs and enterprise software.','No exact suitable live student role.','MONITOR_DAILY','2026-08-30'),
 (9,10,'Local enterprise quality/data software company with an official talent/student route.','Digi2S relational workflows and large-dataset/database experience.','Language and exact current engineering vacancy need role-level confirmation.','MONITOR_DAILY','2026-08-30'),
 (10,13,'Local applied research organization with international research culture and imaging software.','Python, data pipelines, APIs and research-software readiness.','No suitable live role verified.','MONITOR_DAILY','2026-08-30'),
 (11,14,'Local AI research organization and strong English/research environment.','Python, data engineering and incoming IT-security MSc.','No live suitable student position verified.','MONITOR_WEEKLY','2026-08-30'),
 (12,17,'Underrated local logistics employer with verified application-development function.','Chargerzilla/BrandedUK large datasets, SQL, APIs and logistics-transferable backend.','Student route and language at role level are not verified.','INVESTIGATE','2026-08-30'),
 (13,46,'Shipping is data-intensive and the employer has a substantial local digital organization.','Large datasets, ETL, APIs and international-client experience.','Direct student-hiring and stack evidence need strengthening.','INVESTIGATE','2026-08-30'),
 (14,55,'Local industrial digital unit was undervalued by the original generic source.','Enterprise workflows, cloud/backend and data integration.','Student route remains unverified.','INVESTIGATE','2026-08-30'),
 (15,9,'Local fintech/platform employer with credible engineering and flexible careers infrastructure.','Node/TypeScript, PostgreSQL, APIs, AWS and high-volume backend.','No local technical student vacancy verified.','MONITOR_WEEKLY','2026-08-30'),
 (16,48,'Large local diagnostics employer with genuine software/data functions and recurring career activity.','Data pipelines, backend/database work and medical-software adjacency.','No matching live student role; German likely matters.','MONITOR_WEEKLY','2026-08-30'),
 (17,88,'Niche geospatial employer with a thesis/speculative route and direct domain overlap.','PostGIS optimization, mapping, QGIS-adjacent tools and geodata.','Hamburg commute and no exact paid Werkstudent vacancy.','PREPARE_FOR_APPLICATION','2026-08-30'),
 (18,67,'Specialized geospatial/data company; original ranking underweighted niche fit.','PostGIS, geospatial processing and large spatial datasets.','Kiel is hybrid-only and student hiring is not verified.','INVESTIGATE','2026-08-30'),
 (19,81,'Very strong English AI automation role evidence and exact data/API scripting match.','Python/JavaScript, APIs, structured data, ETL and automation.','March PDF remains hosted but current application status is uncertain; Hamburg commute.','INVESTIGATE','2026-08-30'),
 (20,5,'Live local student IT role offers a potentially fast small-employer route.','Linux, troubleshooting, documentation, support and broad technical maturity.','Secure German required and work is support, not software engineering.','INVESTIGATE','2026-08-30');

COMMIT;

-- Keep weak and structural-remove records for provenance, but exclude both from
-- the active decision surface.
CREATE OR REPLACE VIEW v_audited_active_employers AS
SELECT e.*, a.audit_class, a.commute_class, a.monitoring_tier,
       a.recommended_action, a.time_value_judgment, a.audit_notes,
       a.false_positive_flags, a.false_negative_found
FROM employers e JOIN employer_audits a USING (employer_id)
WHERE a.audit_class NOT IN ('WEAK','REMOVE');
