BEGIN;

INSERT INTO monitored_sources(employer_id,university_unit_id,source_name,source_url,source_kind,
 adapter,canonical,priority_tier,source_priority,cadence_hours,discovery_enabled,metadata)
VALUES
(85,NULL,'HanseCom official ATS listing','https://init-portal-hansecom.rexx-systems.com/','OFFICIAL_ATS','hansecom_list',TRUE,'S',1,6,TRUE,'{"scope":"student and technical roles"}'),
(85,NULL,'HanseCom GIS role','https://init-portal-hansecom.rexx-systems.com/Werkstudent-mwd-Geoinformatik-Informatik-de-j1157.html','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,6,FALSE,'{}'),
(85,NULL,'HanseCom Mobile Ticketing role','https://hansecom.com/en/career/student-trainee-for-the-mobile-ticketing-team-mwd.html','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,6,FALSE,'{}'),
(2,NULL,'Fraunhofer student-assistant listing','https://jobs.fraunhofer.de/go/Studentische-Hilfskr%C3%A4fte/4605101/?q=&sortColumn=referencedate&sortDirection=desc','OFFICIAL_ATS','fraunhofer_list',TRUE,'S',1,8,TRUE,'{"filter_city":"Lübeck","filter_institute":"IMTE"}'),
(2,NULL,'Fraunhofer IMTE current frontend role','https://jobs.fraunhofer.de/job/L%C3%BCbeck-Studentische-Hilfskraft-Frontend-Entwicklung-%26-UX-Design-f%C3%BCr-Medizintechnik-%28all-genders%29-23562/1430796633/','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,6,FALSE,'{}'),
(2,NULL,'Fraunhofer IMTE student routes','https://www.imte.fraunhofer.de/de/karriere-studium/studium.html','OFFICIAL_STUDENT_PAGE','career_page',TRUE,'S',2,24,FALSE,'{}'),
(1,NULL,'Dräger software careers','https://www.draeger.com/de_de/Career/Professions/Software-Engineering','OFFICIAL_CAREERS','drager_list',TRUE,'S',1,8,TRUE,'{}'),
(1,NULL,'Dräger R&D software internship/thesis','https://erecruitment.draeger.com/index.php?ac=jobad&id=12310','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,8,FALSE,'{}'),
(1,NULL,'Dräger Software Operations student role','https://erecruitment.draeger.com/index.php?ac=jobad&id=19452&language=1','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,8,FALSE,'{}'),
(1,NULL,'Dräger closed Python HIL Werkstudent role','https://erecruitment.draeger.com/index.php?ac=jobad&id=19484&language=1','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',3,24,FALSE,'{"expected_closed":true}'),
(6,NULL,'VisiConsult Personio listing','https://visiconsult-x-ray-systems-solutions-gmbh.jobs.personio.de/?language=en','OFFICIAL_ATS','personio_list',TRUE,'S',1,8,TRUE,'{}'),
(6,NULL,'VisiConsult student unsolicited route','https://visiconsult-x-ray-systems-solutions-gmbh.jobs.personio.de/job/449656?language=en','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',2,12,FALSE,'{"evergreen":true}'),
(3,NULL,'singularIT job listing','https://www.singular-it.de/jobs','OFFICIAL_CAREERS','singularit_list',TRUE,'S',1,6,TRUE,'{"filter_location":"Lübeck"}'),
(3,NULL,'singularIT backend Werkstudent Lübeck','https://www.singular-it.de/jobs/stellenangebot/12/back-end-software-developer-in','OFFICIAL_JOB_DETAIL','job_detail',TRUE,'S',1,6,FALSE,'{}')
ON CONFLICT (source_url) DO UPDATE SET
 source_name=EXCLUDED.source_name,adapter=EXCLUDED.adapter,source_kind=EXCLUDED.source_kind,
 priority_tier=EXCLUDED.priority_tier,source_priority=EXCLUDED.source_priority,
 cadence_hours=EXCLUDED.cadence_hours,enabled=TRUE,metadata=EXCLUDED.metadata,updated_at=now();

-- University sources are deliberately separate. A central university page is
-- not a substitute for institute/group-level monitoring.
INSERT INTO monitored_sources(employer_id,university_unit_id,source_name,source_url,source_kind,
 adapter,canonical,priority_tier,source_priority,cadence_hours,discovery_enabled,metadata)
SELECT 12,u.unit_id,x.source_name,x.source_url,x.source_kind,x.adapter,TRUE,'S',x.source_priority,
       x.cadence_hours,x.discovery_enabled,x.metadata::jsonb
FROM (VALUES
 ('Institut für IT-Sicherheit (ITS)','ITS institute page','https://www.its.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institut für Softwaretechnik und Programmiersprachen (ISP)','ISP institute page','https://www.isp.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institut für Technische Informatik (ITI)','ITI HiWi page','https://www.iti.uni-luebeck.de/studiiti/hilfskraefte.html','OFFICIAL_INSTITUTE_PAGE','university_page',1,12,TRUE,'{}'),
 ('Institut für Technische Informatik (ITI)','ITI secure RISC-V HiWi','https://www.iti.uni-luebeck.de/en/staff/christian-ewert-m-sc.html','OFFICIAL_JOB_DETAIL','job_detail',1,8,FALSE,'{}'),
 ('Institut für Technische Informatik (ITI)','ITI Arrowhead Tools HiWi PDF','https://www.iti.uni-luebeck.de/fileadmin/website/Mitarbeiter/Ghofrani/HiWi_UzL.pdf','OFFICIAL_RESOURCE','static_job_resource',1,12,FALSE,'{"title":"HiWi – Intelligent Systems Lab / Arrowhead Tools","location":"Lübeck","opportunity_type":"Student Assistant","enrollment_requirement":"Enrolled at the University of Lübeck as a bachelor or master student.","language_bucket":"NO_GERMAN_THRESHOLD_STATED","technologies":["Java","Industrial IoT","Arrowhead Tools"],"description":"English official PDF: Java development for Arrowhead Tools and Industrial IoT; requirements analysis, design, testing, implementation, documentation, deployment and research data."}'),
 ('Institut für Telematik (ITM)','ITM institute page','https://www.itm.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institut für Informationssysteme (IFIS)','IFIS institute page','https://www.ifis.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',1,24,TRUE,'{}'),
 ('Institut für Medizinische Informatik (IMI)','IMI institute page','https://www.imi.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institute of Mathematics and Image Computing (MIC)','MIC institute page','https://www.mic.uni-luebeck.de/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institut für Neuro- und Bioinformatik (INB)','INB HiWi administration','https://www.inb.uni-luebeck.de/hiwis-mitarbeit-am-inb','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Zentrum für Künstliche Intelligenz Lübeck (ZKIL)','ZKIL research center','https://research.uni-luebeck.de/de/organisations/center-for-artificial-intelligence-luebeck-zkil/','OFFICIAL_INSTITUTE_PAGE','university_page',2,24,TRUE,'{}'),
 ('Institut für Theoretische Informatik (TCS)','TCS student positions','https://www.tcs.uni-luebeck.de/de/institut/stellen/','OFFICIAL_INSTITUTE_PAGE','university_page',1,12,TRUE,'{}')
) AS x(unit_name,source_name,source_url,source_kind,adapter,source_priority,cadence_hours,discovery_enabled,metadata)
JOIN university_units u ON u.institution='Universität zu Lübeck' AND u.unit_name=x.unit_name
ON CONFLICT (source_url) DO UPDATE SET
 university_unit_id=EXCLUDED.university_unit_id,source_name=EXCLUDED.source_name,
 adapter=EXCLUDED.adapter,source_kind=EXCLUDED.source_kind,priority_tier='S',
 source_priority=EXCLUDED.source_priority,cadence_hours=EXCLUDED.cadence_hours,
 enabled=TRUE,metadata=EXCLUDED.metadata,updated_at=now();

COMMIT;
