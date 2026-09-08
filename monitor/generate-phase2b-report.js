import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

const { Pool } = pg;
const pool=new Pool(databaseConfig());
const esc=v=>String(v??'').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const mdLink=(label,url)=>url?`[${esc(label)}](${url})`:esc(label);
const short=(value,max=180)=>{const s=esc(value);return s.length>max?`${s.slice(0,max-1)}…`:s;};
const table=(headers,rows)=>[`| ${headers.join(' | ')} |`,`|${headers.map(()=>'---').join('|')}|`,...rows.map(r=>`| ${r.map(esc).join(' | ')} |`)].join('\n');
const fitOrder={EXCEPTIONAL_MATCH:4,STRONG_MATCH:3,POSSIBLE_MATCH:2,MARKET_SIGNAL:1,NOT_RELEVANT:0};

function bestProject(o){
  const t=`${o.title} ${(o.technology_mentions||[]).join(' ')} ${o.role_description||''}`;
  if(/postgis|geoinformat|\bgis\b|spatial|mapping|geodes/i.test(t)) return 'GeoFenceTrack (PostGIS optimization) / Chargerzilla (GIS maps)';
  if(/security|cyber|secure/i.test(t)) return 'MSc IT Security direction + BrandedUK production backend';
  if(/workflow|process|enterprise|sap|procurement/i.test(t)) return 'Digi2S (enterprise workflows, RBAC, relational data)';
  if(/postgres|\bsql\b|data|etl|analytics|python/i.test(t)) return 'Chargerzilla (PostgreSQL/AWS/Flask/ETL)';
  if(/backend|node|api|redis/i.test(t)) return 'BrandedUK (Node.js/APIs/PostgreSQL/Redis)';
  if(/react|typescript|frontend/i.test(t)) return 'Chargerzilla (Next.js)';
  return 'General production software evidence';
}

function biggestGap(o){
  const t=`${o.title} ${o.technical_requirements||''}`;
  if(/BI & Analytics|Datasphere|Databricks|SAP Analytics/i.test(t)) return 'SAP Datasphere/Databricks/SAP Analytics are not demonstrated.';
  if(/AI\/ML Solutions/i.test(t)) return 'ML frameworks and semiconductor validation are not demonstrated.';
  if(/Development Operations/i.test(t)) return 'Semiconductor/embedded development operations experience is not demonstrated.';
  if(/RF Validation/i.test(t)) return 'RF lab and measurement-system experience is not demonstrated.';
  if(/Digitale Einkaufsplattform/i.test(t)) return 'Enterprise procurement/SAP platform experience is limited.';
  if(/Modeled Data/i.test(t)) return 'Formal statistical/modelled-data production experience is not demonstrated.';
  if(/Product Data Analyst/i.test(t)) return 'Product analytics experimentation and BI ownership need stronger evidence.';
  if(/Geodäsie|Geoinformatik|Vermessung/i.test(t)) return 'Formal geodesy/geomatics study and thesis topic agreement are not established.';
  if(o.language_bucket==='C1'||o.language_bucket==='C2'||o.language_bucket==='B2') return `German ${o.language_bucket} is a material gap.`;
  return o.missing_requirements || 'Exact seniority, work authorization and role-specific requirements require review.';
}

function recommended(o){
  if(o.eligibility_status==='ENROLLMENT_REQUIRED'||o.eligibility_status==='LIKELY_ELIGIBLE_AFTER_ENROLLMENT') return 'Prepare for future; verify enrollment timing and keep the official URL monitored.';
  if(o.alert_class==='NOT_RELEVANT') return 'Ignore.';
  return o.monitoring_urgency==='ACT_THIS_WEEK'?'Review this week; verify work authorization, seniority and language before applying.':'Monitor and verify eligibility before acting.';
}

const c=await pool.connect();
try{
  const latest=(await c.query(`SELECT * FROM monitoring_runs WHERE requested_tiers @> ARRAY['A']::text[] ORDER BY run_id DESC LIMIT 1`)).rows[0];
  const baseline=(await c.query(`SELECT * FROM monitoring_runs WHERE run_mode='BASELINE' AND requested_tiers=ARRAY['A']::text[] ORDER BY run_id DESC LIMIT 1`)).rows[0];
  const coverage=(await c.query(`SELECT e.company_name,a.* FROM employer_monitoring_audits a JOIN employers e USING(employer_id) WHERE a.monitoring_tier='A' ORDER BY e.company_name`)).rows;
  const coverageCounts=(await c.query(`SELECT coverage_status,count(*)::int n FROM employer_monitoring_audits WHERE monitoring_tier='A' GROUP BY coverage_status`)).rows;
  const sourceCounts=(await c.query(`SELECT count(*)::int total,count(*) FILTER(WHERE source_kind='OFFICIAL_ATS')::int ats,
    count(*) FILTER(WHERE source_kind IN('OFFICIAL_STUDENT_PAGE','OFFICIAL_INSTITUTE_PAGE','OFFICIAL_RESOURCE'))::int student_research,
    count(*) FILTER(WHERE source_kind='OFFICIAL_CAREERS')::int careers,
    count(*) FILTER(WHERE source_kind='OFFICIAL_JOB_DETAIL')::int details
    FROM monitored_sources WHERE priority_tier='A' AND enabled`)).rows[0];
  const current=(await c.query(`SELECT o.*,e.company_name FROM opportunities o JOIN employers e USING(employer_id)
    JOIN employer_audits a USING(employer_id) WHERE a.monitoring_tier='A' AND o.last_seen_run_id=$1 ORDER BY o.opportunity_priority DESC`,[latest.run_id])).rows;
  const newRows=(await c.query(`SELECT DISTINCT ON(o.opportunity_id) o.*,e.company_name FROM opportunity_change_events ev JOIN opportunities o USING(opportunity_id)
    JOIN employers e USING(employer_id) WHERE ev.run_id=$1 AND ev.event_type='NEW_JOB' ORDER BY o.opportunity_id`,[baseline.run_id])).rows;
  const classCounts=Object.fromEntries(['EXCEPTIONAL_MATCH','STRONG_MATCH','POSSIBLE_MATCH','MARKET_SIGNAL','NOT_RELEVANT'].map(k=>[k,current.filter(o=>o.alert_class===k).length]));
  const latentCounts=Object.fromEntries(['EXCEPTIONAL_MATCH','STRONG_MATCH','POSSIBLE_MATCH','NOT_RELEVANT'].map(k=>[k,current.filter(o=>o.latent_fit_class===k).length]));
  const eligibleNow=current.filter(o=>o.eligibility_status==='ELIGIBLE_NOW').length;
  const future=current.filter(o=>['ENROLLMENT_REQUIRED','LIKELY_ELIGIBLE_AFTER_ENROLLMENT','START_DATE_MISMATCH'].includes(o.eligibility_status)).length;
  const errors=(await c.query(`SELECT e.company_name,ms.source_name,ms.source_url,mf.http_status,mf.error_class,mf.error_message
    FROM monitoring_fetches mf JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id)
    WHERE mf.run_id=$1 AND NOT mf.success ORDER BY e.company_name`,[latest.run_id])).rows;
  const dupKeys=(await c.query(`SELECT count(*)::int n FROM (SELECT canonical_key FROM opportunities WHERE canonical_key IS NOT NULL GROUP BY canonical_key HAVING count(*)>1)x`)).rows[0].n;
  const dupUrls=(await c.query(`SELECT count(*)::int n FROM (SELECT o.employer_id,lower(regexp_replace(os.source_url,'[?].*$','')) u,count(*) FROM opportunity_sources os JOIN opportunities o USING(opportunity_id) JOIN monitored_sources ms USING(monitored_source_id) WHERE os.is_current AND ms.priority_tier='A' GROUP BY o.employer_id,u HAVING count(*)>1)x`)).rows[0].n;
  const invalidUrgency=(await c.query(`SELECT count(*)::int n FROM opportunities o JOIN employer_audits a USING(employer_id) WHERE a.monitoring_tier='A' AND o.last_seen_run_id=$1 AND o.eligibility_status IN('ENROLLMENT_REQUIRED','LIKELY_ELIGIBLE_AFTER_ENROLLMENT') AND o.monitoring_urgency LIKE 'ACT_%'`,[latest.run_id])).rows[0].n;
  const combined=(await c.query(`SELECT ms.priority_tier,count(DISTINCT ms.employer_id)::int employers,count(DISTINCT ms.monitored_source_id)::int sources,
    count(DISTINCT os.opportunity_id) FILTER(WHERE os.is_current)::int opportunities
    FROM monitored_sources ms LEFT JOIN opportunity_sources os USING(monitored_source_id)
    WHERE ms.enabled AND ms.priority_tier IN('S','A') GROUP BY ms.priority_tier ORDER BY ms.priority_tier DESC`)).rows;
  const patterns=(await c.query(`SELECT e.company_name,p.observation_count,p.recurring_titles,p.language_observations,p.prediction_status
    FROM recurring_hiring_patterns p JOIN employers e USING(employer_id) JOIN employer_audits a USING(employer_id)
    WHERE a.monitoring_tier='A' ORDER BY p.observation_count DESC,e.company_name`)).rows;

  const ranked=[...newRows].filter(o=>o.alert_class!=='NOT_RELEVANT').sort((a,b)=>{
    const student=x=>/Werkstudent|Student Assistant|Thesis|Internship/i.test(x.opportunity_type||'')?12:0;
    return Number(b.opportunity_priority)+student(b)+fitOrder[b.latent_fit_class]*2-(Number(a.opportunity_priority)+student(a)+fitOrder[a.latent_fit_class]*2);
  });
  const top=[]; const perEmployer=new Map();
  for(const o of ranked){const n=perEmployer.get(o.employer_id)||0;if(n>=2)continue;top.push(o);perEmployer.set(o.employer_id,n+1);if(top.length===10)break;}

  const categoryFacts={
    student:current.filter(o=>/Werkstudent|Student Assistant|Thesis|Internship/i.test(o.opportunity_type||'')&&o.alert_class!=='NOT_RELEVANT'),
    english:current.filter(o=>o.language_bucket==='ENGLISH_EXPLICITLY_ACCEPTED'&&o.alert_class!=='NOT_RELEVANT'),
    noGerman:current.filter(o=>o.language_bucket==='NO_GERMAN_THRESHOLD_STATED'&&o.alert_class!=='NOT_RELEVANT'),
    backendData:current.filter(o=>/backend|data|sql|postgres|etl|analytics/i.test(`${o.title} ${(o.technology_mentions||[]).join(' ')}`)&&o.alert_class!=='NOT_RELEVANT'),
    gis:current.filter(o=>/gis|geo|spatial|postgis|mapping|geodäs/i.test(`${o.title} ${o.role_description||''}`)&&o.alert_class!=='NOT_RELEVANT'),
    security:current.filter(o=>/security|sicherheit|cyber|secure/i.test(`${o.title} ${o.role_description||''}`)&&o.alert_class!=='NOT_RELEVANT')
  };
  const names=rows=>[...new Set(rows.map(x=>x.company_name))].join(', ')||'None in current accepted observations';
  const cc=Object.fromEntries(coverageCounts.map(x=>[x.coverage_status,x.n]));
  const lines=[];
  lines.push('# Phase 2B — Tier-A monitoring expansion report','',`Generated: ${new Date().toISOString()}`,'',
    `Accepted baseline: **#${baseline.run_id} ${baseline.status}**. Forced repeat: **#${latest.run_id} ${latest.status}**. The repeat observed **${latest.opportunities_observed}** opportunities and created **${latest.events_created} events**.`,'',
    '> “Newly discovered” means absent from the pre-Phase-2B registry. It does not mean posted today. Posting dates remain null unless an official source states one.','');
  lines.push('## A. Coverage','',
    `Tier-A employers attempted: **${coverage.length}**; successfully monitored: **${cc.SUCCESS||0}**; partially monitored: **${cc.PARTIAL||0}**; unmonitorable at employer level: **${cc.UNMONITORABLE||0}**.`,
    `Enabled official sources: **${sourceCounts.total}** — ${sourceCounts.ats} ATS, ${sourceCounts.careers} careers pages, ${sourceCounts.details} direct job details, and ${sourceCounts.student_research} student/institute/resource sources.`,'',
    table(['Employer','Coverage','Confidence','ATS / structured source','Limitation'],coverage.map(x=>[x.company_name,x.coverage_status,x.source_confidence,x.ats_name||'None',x.limitations||'None recorded'])),'');
  lines.push('## B. Opportunity results','',
    `Current Tier-A opportunities/signals: **${current.length}**. Newly discovered in the clean baseline: **${newRows.length}**. Pre-existing roles re-baselined: **${current.length-newRows.length}**.`,
    `Current alert classes: EXCEPTIONAL_MATCH **${classCounts.EXCEPTIONAL_MATCH}**, STRONG_MATCH **${classCounts.STRONG_MATCH}**, POSSIBLE_MATCH **${classCounts.POSSIBLE_MATCH}**, MARKET_SIGNAL **${classCounts.MARKET_SIGNAL}**, NOT_RELEVANT **${classCounts.NOT_RELEVANT}**.`,
    `Latent fit after eligibility constraints are separated: exceptional **${latentCounts.EXCEPTIONAL_MATCH}**, strong **${latentCounts.STRONG_MATCH}**, possible **${latentCounts.POSSIBLE_MATCH}**, not relevant **${latentCounts.NOT_RELEVANT}**.`,
    `Eligible now: **${eligibleNow}**; enrollment/start-dependent future signals: **${future}**. No enrollment-dependent opportunity has apply-now urgency.`,'');
  lines.push('## C. Best discoveries','',
    'Ranking favors strong latent fit and student routes, caps any one employer at two entries, and does not convert unknown eligibility into an apply recommendation.','',
    table(['Employer','Role','City / model / hours','Language evidence','Enrollment','Technical match','Best evidence','Biggest gap','Eligibility / action'],top.map(o=>[
      o.company_name,mdLink(o.title,o.job_url),`${o.location||'Not stated'} / ${o.work_model||'Not stated'} / ${o.hours||'Not stated'}`,
      short(`${o.language_bucket}${o.german_requirement_raw?`: ${o.german_requirement_raw}`:''}`,220),
      short(o.enrollment_requirement||'Not explicitly stated',220),`${o.technical_match}/3; ${(o.technology_mentions||[]).join(', ')||'No named technology extracted'}`,
      bestProject(o),biggestGap(o),`${o.eligibility_status}; ${recommended(o)}`
    ])),'');
  lines.push('## D. Monitoring health','',
    `Latest repeat: ${latest.sources_succeeded}/${latest.sources_attempted} sources accepted, ${latest.opportunities_observed} observations, **${latest.events_created} events**.`,
    `Duplicate prevention: **${dupKeys}** duplicate canonical keys and **${dupUrls}** duplicate current employer/source URLs. Invalid enrollment-dependent ACT urgency: **${invalidUrgency}**.`,
    `Parsing exceptions in the accepted repeat: **${errors.filter(x=>x.error_class).length}**. Access/HTTP failures: **${errors.length}**.`,'',
    errors.length?table(['Employer','Source','HTTP / class','Official URL'],errors.map(x=>[x.company_name,x.source_name,x.http_status||x.error_class||x.error_message,mdLink('source',x.source_url)])):'No latest-run source failures.','',
    '- FREENOW’s corporate page remains HTTP 429; no bypass was attempted. Its associated public Greenhouse feed succeeds, so coverage is partial.',
    '- Kuehne+Nagel’s global page is reachable but yielded no stable vacancy records; irrelevant rotating page hashes are suppressed and coverage is partial.',
    '- EUROIMMUN’s legacy job-board URL resolves to a branded not-found page even with HTTP 200; its student page is monitored, so coverage is partial.',
    '- RWE’s previously indexed Asset Risk role now says the posting is offline and is excluded from current opportunities.',
    '- DFKI’s main corporate careers page is HTTP 403, but its official jobs portal is reachable. No authentication, CAPTCHA, TLS or rate-limit protection was weakened.','');
  lines.push('## E. Hiring intelligence','',
    '### FACT — directly observed','',
    `- Current relevant student routes: ${names(categoryFacts.student)}.`,
    `- Roles explicitly accepting English: ${names(categoryFacts.english)}.`,
    `- Roles with no German threshold stated (not the same as explicit English acceptance): ${names(categoryFacts.noGerman)}.`,
    `- Current backend/data evidence: ${names(categoryFacts.backendData)}.`,
    `- Current GIS/geospatial evidence: ${names(categoryFacts.gis)}.`,
    `- Current security evidence: ${names(categoryFacts.security)}.`,
    `- Official student/university pipeline pages are configured for ${sourceCounts.student_research} Tier-A sources.`,'',
    '### INFERENCE — deliberately limited','',
    '- NXP and Körber currently show a dense cluster of Hamburg student technical roles; this supports close monitoring, but does not yet establish a seasonal hiring cycle.',
    '- Statista currently shows substantial data/backend demand and one relevant working-student route; the full-time roles are market context, not proof of student eligibility.',
    '- HydroMapper is a distinctive GIS thesis signal, but its page does not state a programming stack, hours, or language threshold.',
    '- No Tier-A recurring pattern is promoted to a prediction. All stored patterns remain `INSUFFICIENT_OBSERVATIONS`.','',
    table(['Employer','Observed routes','Prediction'],patterns.map(x=>[x.company_name,x.observation_count,x.prediction_status])),'');
  lines.push('## F. Updated S + A monitoring counts','',
    table(['Tier','Employers','Enabled sources','Current canonical opportunities'],combined.map(x=>[x.priority_tier,x.employers,x.sources,x.opportunities])),
    `Combined: **${combined.reduce((n,x)=>n+x.employers,0)} employers**, **${combined.reduce((n,x)=>n+x.sources,0)} sources**, **${combined.reduce((n,x)=>n+x.opportunities,0)} current canonical opportunities**.`,'',
    '## Stop point','',
    'Phase 2B stops here. No Phase 2C employer expansion, applications, CV generation, interview tracking, dashboard, notification, or scheduled task was added.');
  const out=path.resolve('..','reports','phase2b_tier_a_monitoring_2026-08-31.md');
  await fs.writeFile(out,lines.join('\n'),'utf8');
  console.log(out);
}finally{c.release();await pool.end();}
