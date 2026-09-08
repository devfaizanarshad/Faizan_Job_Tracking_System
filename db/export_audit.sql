\set ON_ERROR_STOP on
\copy (SELECT e.employer_id,e.company_name,e.office_city,a.audit_class,a.technical_function_evidence,a.student_hiring_evidence_strength,a.language_evidence_strength,a.stack_evidence_strength,a.source_quality,a.commute_class,a.monitoring_tier,a.recommended_action,a.false_positive_flags,a.false_negative_found,a.time_value_judgment,a.audit_notes,a.audited_at FROM employers e JOIN employer_audits a USING(employer_id) ORDER BY e.employer_id) TO 'exports/employer_audit_2026-08-30.csv' CSV HEADER
\copy (SELECT * FROM v_audited_top20 ORDER BY rank) TO 'exports/top20_2026-08-30.csv' CSV HEADER
\copy (SELECT * FROM v_verified_opportunities_right_now) TO 'exports/verified_opportunities_2026-08-30.csv' CSV HEADER
\copy (SELECT * FROM university_units ORDER BY priority,unit_name) TO 'exports/university_units_2026-08-30.csv' CSV HEADER
\copy (SELECT * FROM v_quarantined_employers ORDER BY audit_class,company_name) TO 'exports/quarantined_employers_2026-08-30.csv' CSV HEADER
\copy (SELECT e.employer_id,e.company_name,e.office_city,a.audit_class,a.monitoring_tier,a.recommended_action,e.careers_url,e.job_search_url FROM employers e JOIN employer_audits a USING(employer_id) ORDER BY CASE a.monitoring_tier WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,e.company_name) TO 'exports/monitoring_shortlist_2026-08-30.csv' CSV HEADER
