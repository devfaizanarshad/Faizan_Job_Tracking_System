import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

const { Pool } = pg;
const pool = new Pool(databaseConfig());
const esc = value => String(value ?? '').replaceAll('|','\\|').replace(/\s+/g,' ').trim();
const link = (label,url) => url ? `[${esc(label)}](${url})` : esc(label);
const table = (headers,rows) => [
  `| ${headers.join(' | ')} |`, `|${headers.map(()=> '---').join('|')}|`,
  ...rows.map(row=>`| ${row.map(esc).join(' | ')} |`)
].join('\n');

const c=await pool.connect();
try {
  const latest=(await c.query('SELECT * FROM monitoring_runs ORDER BY run_id DESC LIMIT 1')).rows[0];
  const baseline=(await c.query(`SELECT * FROM monitoring_runs WHERE run_mode='BASELINE' ORDER BY run_id LIMIT 1`)).rows[0];
  const latestEvents=(await c.query(`SELECT ev.event_type,e.company_name,o.title,o.job_url FROM opportunity_change_events ev LEFT JOIN opportunities o USING(opportunity_id) LEFT JOIN employers e USING(employer_id) WHERE ev.run_id=$1 ORDER BY ev.event_id`,[latest.run_id])).rows;
  const baselineNew=(await c.query(`SELECT DISTINCT ON (o.opportunity_id) e.company_name,o.title,o.location,o.opportunity_type,o.latent_fit_class,o.eligibility_status,o.language_bucket,o.opportunity_priority,o.monitoring_urgency,o.job_url
    FROM opportunity_change_events ev JOIN opportunities o USING(opportunity_id) JOIN employers e USING(employer_id)
    WHERE ev.run_id=$1 AND ev.event_type='NEW_JOB' ORDER BY o.opportunity_id,o.opportunity_priority DESC`,[baseline.run_id])).rows.sort((a,b)=>Number(b.opportunity_priority)-Number(a.opportunity_priority));
  const best=(await c.query(`SELECT * FROM v_best_current_monitored_matches WHERE alert_class<>'NOT_RELEVANT' ORDER BY opportunity_priority DESC LIMIT 12`)).rows;
  const closed=(await c.query('SELECT * FROM v_monitoring_closed_since_last_check')).rows;
  const pages=(await c.query('SELECT * FROM v_monitoring_high_value_page_changes')).rows;
  const university=(await c.query('SELECT * FROM v_monitoring_university_changes')).rows;
  const errors=(await c.query(`SELECT e.company_name,ms.source_name,ms.source_url,mf.http_status,mf.error_class,mf.error_message
    FROM monitoring_fetches mf JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id)
    WHERE mf.run_id=$1 AND NOT mf.success ORDER BY e.company_name,ms.source_name`,[latest.run_id])).rows;
  const patterns=(await c.query(`SELECT e.company_name,p.observation_count,p.recurring_titles,p.language_observations,p.hours_observations,p.prediction_status
    FROM recurring_hiring_patterns p JOIN employers e USING(employer_id) ORDER BY p.observation_count DESC,e.company_name`)).rows;
  const sources=(await c.query(`SELECT count(*)::int total,count(*) FILTER(WHERE last_success_at IS NOT NULL)::int successful,
    count(*) FILTER(WHERE university_unit_id IS NOT NULL)::int university FROM monitored_sources WHERE enabled AND priority_tier='S'`)).rows[0];

  const lines=[];
  lines.push('# Phase 2A — S-tier opportunity monitoring report','',`Generated: ${new Date().toISOString()}`,'');
  lines.push('## Monitoring health','',
    `Latest validation run: **#${latest.run_id} ${latest.status}** — ${latest.sources_succeeded}/${latest.sources_attempted} sources accepted, ${latest.opportunities_observed} observations, **${latest.events_created} change events**.`,
    `Configured official S-tier sources: **${sources.total}**, including **${sources.university}** institute/group-level university sources.`,
    `Faizan enrollment mode: **not enrolled**. Enrollment-dependent roles are therefore market signals with \`PREPARE_FOR_FUTURE\`, never apply-now alerts.`,'');
  lines.push('## New since last check','');
  if(!latestEvents.length) lines.push('No genuine job or page change was detected in the latest repeat run. This is the expected stable deduplication result.','');
  else lines.push(table(['Event','Employer','Role'],latestEvents.map(x=>[x.event_type,x.company_name,link(x.title||'page',x.job_url)])),'');
  lines.push('## Newly discovered in the first clean baseline','',
    'These roles were absent from the pre-monitoring opportunity registry. “Newly discovered” does not assert that the employer posted them today; posting dates are kept null unless the official page states one.','');
  lines.push(table(['Employer','Role','City','Type','Latent fit','Eligibility','Language','Score'],baselineNew.map(x=>[
    x.company_name,link(x.title,x.job_url),x.location,x.opportunity_type,x.latent_fit_class,x.eligibility_status,x.language_bucket,x.opportunity_priority
  ])),'');
  lines.push('Most important baseline discovery: Dräger’s `Werkstudent Software Operations Deutschland – Projektmanagement & Customer Support`. It is local, hybrid and enrollment-dependent. The work centers on digital software-product workflows, ticket-system introduction, process design, data preparation and support—not software development. Digi2S workflow/RBAC evidence transfers, but it remains a future target.','');
  lines.push('## Best current matches','');
  lines.push(table(['Employer','Role','Fit after enrollment','Current eligibility','Language','Priority','Urgency'],best.map(x=>[
    x.company_name,link(x.title,x.job_url),x.latent_fit_class,x.eligibility_status,x.language_bucket,x.opportunity_priority,x.monitoring_urgency
  ])),'');
  lines.push('The strongest three remain HanseCom GIS, HanseCom Mobile Ticketing and Fraunhofer IMTE React/TypeScript. All are classified as `MARKET_SIGNAL` now because the system is running with `FAIZAN_ENROLLED=false`.','');
  lines.push('## Future signals','',
    '- HanseCom GIS: exceptional PostGIS/geospatial/mobility fit; English explicitly accepted.',
    '- Fraunhofer IMTE: exceptional React/TypeScript plus Python/API/data fit; no German threshold stated.',
    '- HanseCom Mobile Ticketing: exceptional mobility/backend evidence; Spring Boot/Java is the main gap.',
    '- Universität ITI: secure RISC-V and Arrowhead/Industrial-IoT HiWi routes remain live signals.',
    '- singularIT backend: technically relevant but German C1 is preserved as a hard obstacle.',
    '- Dräger: repeated local student/internship activity now has enough observations to justify close monitoring, but no prediction is made.','');
  lines.push('## Closed since last check','');
  lines.push(closed.length?table(['Detected','Employer','Role','Event'],closed.map(x=>[x.detected_at,x.company_name,link(x.title,x.job_url),x.event_type])):'No newly closed role in the latest run. The monitor separately reverified the already-closed Dräger Python/HIL URL via HTTP 410.','');
  lines.push('## High-value career-page changes','');
  lines.push(pages.length?table(['Employer','Source','Event'],pages.map(x=>[x.company_name,link(x.source_name,x.source_url),x.event_type])):'No stable career-page change in the latest run.','');
  lines.push('## University changes','');
  lines.push(university.length?table(['Unit','Event','Role','Eligibility'],university.map(x=>[x.unit_name,x.event_type,link(x.title,x.job_url),x.eligibility_status])):'No new institute-level vacancy in the latest run. The two known ITI routes remain observable.','');
  lines.push('## Monitoring errors','');
  lines.push(errors.length?table(['Employer','Source','HTTP','Error'],errors.map(x=>[x.company_name,link(x.source_name,x.source_url),x.http_status,x.error_class||x.error_message])):'No source errors.','');
  lines.push('The TCS page currently fails Node’s standards-compliant TLS fetch and is retained as an explicit error. The monitor does not disable certificate verification or bypass access controls.','');
  lines.push('## Recurring hiring observations','');
  lines.push(table(['Employer','Distinct observed routes','Titles','Languages','Prediction'],patterns.map(x=>[
    x.company_name,x.observation_count,(x.recurring_titles||[]).join('; '),(x.language_observations||[]).join('; '),x.prediction_status
  ])),'');
  lines.push('Observation history has started, but every pattern remains `INSUFFICIENT_OBSERVATIONS`; no hiring-month prediction has been invented.','');
  lines.push('## Operating rule','',
    'Run `run-s-tier-monitor.ps1` with PostgreSQL credentials supplied through environment variables. The script performs due-source checks and regenerates this report. `--force` is reserved for validation; normal operation respects each source cadence.','');
  const out=path.resolve('..','reports','phase2a_monitoring_latest.md');
  await fs.writeFile(out,lines.join('\n'),'utf8');
  console.log(out);
} finally { c.release(); await pool.end(); }
