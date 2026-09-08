BEGIN;

UPDATE opportunities
SET status = 'UNKNOWN',
    relevance_note = relevance_note || ' Posting age exceeds the safe live-status threshold; verify before applying.'
WHERE employer_id = (SELECT employer_id FROM employers WHERE company_name = 'embeff GmbH')
  AND title = 'Werkstudent Embedded Software';

UPDATE employers
SET current_student_hiring = 'Historical/uncertain technical student role',
    current_relevant_jobs = 'Embedded-software Werkstudent PDF exists, but posting age requires status verification.',
    speed_to_interview = 'Unknown',
    speed_reason = 'Relevant student evidence exists, but the vacancy is too old to label live safely.',
    target_status = 'RESEARCH_MORE',
    fact_inference_status = 'Historical vacancy is fact; current availability is unknown.'
WHERE company_name = 'embeff GmbH';

UPDATE opportunities
SET status = 'UNKNOWN',
    relevance_note = relevance_note || ' Posting is several months old; verify on the RWE portal before applying.'
WHERE employer_id = (SELECT employer_id FROM employers WHERE company_name = 'RWE Renewables Europe & Australia GmbH')
  AND title = 'Working Student Engineering GIS';

UPDATE employers
SET current_student_hiring = 'Historical/uncertain relevant role',
    current_relevant_jobs = 'GIS working-student advertisement is highly relevant but old enough to require live-status verification.',
    speed_to_interview = 'Unknown',
    speed_reason = 'Excellent technical match, but current vacancy status is uncertain.',
    target_status = 'RESEARCH_MORE',
    fact_inference_status = 'Role content and language requirements are facts; current availability is unknown.'
WHERE company_name = 'RWE Renewables Europe & Australia GmbH';

COMMIT;
