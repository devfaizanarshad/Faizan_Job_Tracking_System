import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { deliverLocalAlert } from './delivery-adapters.js';
import { runtimePaths } from './runtime-paths.js';
import { databaseConfig } from './database-config.js';

const { Pool } = pg;
const poolConfig = databaseConfig();

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const technicalText = o => clean(`${o.title} ${(o.technology_mentions || []).join(' ')} ${o.technical_requirements} ${o.role_description}`);
const studentRole = o => /werkstudent|working student|student assistant|studentische|hiwi|internship|praktikum|thesis|abschlussarbeit/i
  .test(`${o.title} ${o.opportunity_type} ${o.employment_type}`);
const temporaryBlock = status => ['ENROLLMENT_REQUIRED','LIKELY_ELIGIBLE_AFTER_ENROLLMENT','START_DATE_MISMATCH','FUTURE_ARRIVAL'].includes(status);
const languageOkay = bucket => ['ENGLISH_EXPLICITLY_ACCEPTED','NO_GERMAN_THRESHOLD_STATED'].includes(bucket);

export function effectiveEligibility(opportunity, profile) {
  const enrolled = profile?.enrollment_status === 'ENROLLED';
  if (studentRole(opportunity) || opportunity.enrollment_requirement) {
    return enrolled ? 'ELIGIBLE_NOW' : 'ENROLLMENT_REQUIRED';
  }
  const outsideGermany = /outside germany/i.test(profile?.current_status || '');
  const germanLocation = /hamburg|lübeck|luebeck|ahrensburg|germany|deutschland/i
    .test(`${opportunity.location || ''} ${opportunity.work_model || ''}`);
  if (outsideGermany && germanLocation) return 'FUTURE_ARRIVAL';
  return opportunity.eligibility_status || 'ELIGIBILITY_UNKNOWN';
}

function categoryReasons(opportunity) {
  const text = technicalText(opportunity);
  const reasons = [];
  if (/postgis|\bgis\b|geoinformat|geospatial|spatial|mapping|geodäs/i.test(text)) reasons.push('Rare GIS/PostGIS or geospatial overlap');
  const namedTechCount=(opportunity.technology_mentions || []).length;
  if (/postgres|\bsql\b|data engineer|etl/i.test(text) || (namedTechCount >= 2 && /backend|api|node\.?(?:js)?|aws/i.test(text)))
    reasons.push('Strong backend/data overlap');
  if (/appsec|devsecops|it.?security|cyber|secure|security/i.test(text)) reasons.push('Relevant IT Security/AppSec/DevSecOps overlap');
  if (studentRole(opportunity) && opportunity.language_bucket === 'ENGLISH_EXPLICITLY_ACCEPTED') reasons.push('Explicit English-friendly student route');
  if (/hiwi|student assistant|studentische hilfskraft|research assistant|wissenschaftliche/i.test(text)) reasons.push('University/HiWi/research route');
  return reasons;
}

function bestProject(opportunity) {
  const text = technicalText(opportunity);
  if (/postgis|\bgis\b|geospatial|spatial|mapping|geodäs/i.test(text)) return 'GeoFenceTrack / Chargerzilla GIS work';
  if (/security|cyber|appsec|devsec/i.test(text)) return 'MSc IT Security direction / BrandedUK production backend';
  if (/workflow|process|enterprise|sap|procurement/i.test(text)) return 'Digi2S enterprise workflows and relational data';
  if (/postgres|\bsql\b|data|etl|analytics|python/i.test(text)) return 'Chargerzilla PostgreSQL/AWS/Flask/ETL';
  if (/backend|node|api|redis/i.test(text)) return 'BrandedUK Node.js/APIs/PostgreSQL/Redis';
  return 'General production software evidence';
}

function biggestGap(opportunity) {
  if (opportunity.missing_requirements) return clean(opportunity.missing_requirements);
  if (['B2','C1','C2','GERMAN_REQUIRED_UNSPECIFIED_LEVEL'].includes(opportunity.language_bucket))
    return `German requirement: ${opportunity.language_bucket}`;
  return 'Verify role-specific seniority, work authorization, and exact eligibility.';
}

function shortDeadline(opportunity, now = new Date()) {
  if (opportunity.application_deadline) {
    const days = (new Date(opportunity.application_deadline) - now) / 86400000;
    return days >= 0 && days <= 10;
  }
  if (opportunity.source_date) {
    const days = (now - new Date(opportunity.source_date)) / 86400000;
    return days >= 0 && days <= 3;
  }
  return false;
}

export function decideAlert(event, opportunity, profile, now = new Date()) {
  const eligibility = effectiveEligibility(opportunity, profile);
  const categories = categoryReasons(opportunity);
  const technical = Number(opportunity.technical_match || 0) > 0 || categories.length > 0;
  const fit = opportunity.latent_fit_class || opportunity.alert_class || 'NOT_RELEVANT';
  const strongFit = ['EXCEPTIONAL_MATCH','STRONG_MATCH'].includes(fit);
  const rareHighValue = categories.length > 0 && technical;
  const highValue = technical && (strongFit || rareHighValue);
  const isNew = ['NEW_JOB','STUDENT_ROLE_ADDED'].includes(event.event_type);
  const languageBlocked = ['B2','C1','C2','GERMAN_REQUIRED_UNSPECIFIED_LEVEL'].includes(opportunity.language_bucket);
  const blocked = temporaryBlock(eligibility) || languageBlocked;
  const blocker = temporaryBlock(eligibility) ? eligibility : languageBlocked ? `LANGUAGE_${opportunity.language_bucket}` : eligibility;

  let priority = 'P3';
  let action = 'STORE SILENTLY';
  let alertType = event.event_type === 'JOB_CLOSED' || event.event_type === 'JOB_REMOVED'
    ? 'ROLE_CLOSED' : event.event_type;
  let reason = 'Useful market or monitoring information; no immediate action required.';

  if (isNew && highValue && blocked) {
    priority = 'P2'; action = 'PREPARE / KEEP WATCHING'; alertType = 'FUTURE_HIGH_VALUE';
    reason = `High-value technical fit is blocked by ${blocker}; fit does not override eligibility or language evidence.`;
  } else if (isNew && highValue && !blocked) {
    const critical = fit === 'EXCEPTIONAL_MATCH' && eligibility === 'ELIGIBLE_NOW'
      && languageOkay(opportunity.language_bucket) && shortDeadline(opportunity, now);
    priority = critical ? 'P0' : 'P1';
    action = critical ? 'APPLY ASAP' : 'REVIEW TODAY';
    alertType = critical ? 'CRITICAL_NEW_ROLE' : 'HIGH_VALUE_NEW_ROLE';
    reason = critical
      ? 'Exceptional, currently eligible, language-compatible new role with time sensitivity.'
      : 'New technically relevant role with exceptional/strong or rare domain overlap.';
  } else if (['LANGUAGE_REQUIREMENT_CHANGED','DEADLINE_CHANGED','LOCATION_CHANGED','WORK_MODE_CHANGED','JOB_DESCRIPTION_CHANGED'].includes(event.event_type) && highValue) {
    priority = blocked ? 'P2' : 'P1';
    action = blocked ? 'PREPARE / KEEP WATCHING' : 'REVIEW TODAY';
    alertType = `MATERIAL_${event.event_type}`;
    reason = `A material field changed on a high-value opportunity; eligibility remains ${eligibility}.`;
  }

  const reasons = [
    ...categories,
    ...(opportunity.technology_mentions || []).slice(0, 8),
    `Fit: ${fit}`,
    `Eligibility: ${eligibility}`
  ];
  const fingerprint = hash(JSON.stringify({
    alertType, eligibility, language: opportunity.language_bucket,
    deadline: opportunity.application_deadline, location: opportunity.location,
    workModel: opportunity.work_model, state: event.new_state
  }));
  const languageEvidence = clean(opportunity.german_requirement_raw || opportunity.english_requirement_raw || opportunity.language_requirement || opportunity.language_bucket);
  const content = [
    priority === 'P2' ? 'HIGH-VALUE FUTURE OPPORTUNITY' : priority === 'P3' ? 'INFORMATIONAL OPPORTUNITY CHANGE' : 'NEW HIGH-MATCH OPPORTUNITY',
    '', `Company: ${opportunity.company_name}`, `Role: ${opportunity.title}`,
    `Location: ${opportunity.location || 'Not stated'}`, `Work model: ${opportunity.work_model || 'Not stated'}`,
    `Hours: ${opportunity.hours || 'Not stated'}`, `First detected: ${opportunity.first_seen_at || event.detected_at}`,
    `Official URL: ${opportunity.job_url}`, '', `MATCH: ${fit}`, '', 'WHY:',
    ...reasons.map(x => `- ${x}`), '', `BEST PROJECT EVIDENCE: ${bestProject(opportunity)}`,
    '', `LANGUAGE: ${languageEvidence || 'No explicit threshold extracted.'}`,
    '', `ELIGIBILITY: ${eligibility}`, '', `BIGGEST GAP: ${biggestGap(opportunity)}`,
    '', `ACTION: ${action}`
  ].join('\n');
  return { priority, action, alertType, reason, reasons, fingerprint, content, eligibility, highValue };
}

export async function getProfile(client) {
  const { rows } = await client.query('SELECT * FROM monitoring_profile WHERE profile_id=TRUE');
  return rows[0];
}

export async function persistAlertDecision(client, event, opportunity, profile) {
  const decision = decideAlert(event, opportunity, profile);
  const { rows } = await client.query(`INSERT INTO alert_decisions
    (opportunity_id,event_id,alert_type,priority,action,decision_reason,match_reasons,material_fingerprint,rendered_content)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT DO NOTHING RETURNING *`, [opportunity.opportunity_id,event.event_id,decision.alertType,
    decision.priority,decision.action,decision.reason,JSON.stringify(decision.reasons),decision.fingerprint,decision.content]);
  return { decision, alert: rows[0] || null };
}

async function deliverLocal(client, alert, reportsRoot) {
  if (!['P0','P1'].includes(alert.priority)) return 0;
  await deliverLocalAlert(alert,reportsRoot);
  await client.query(`INSERT INTO alert_deliveries(alert_id,channel,delivery_status,delivered_at)
    VALUES($1,'TERMINAL','DELIVERED',now()) ON CONFLICT DO NOTHING`, [alert.alert_id]);
  await client.query(`INSERT INTO alert_deliveries(alert_id,channel,delivery_status,delivered_at)
    VALUES($1,'MARKDOWN','DELIVERED',now()) ON CONFLICT DO NOTHING`, [alert.alert_id]);
  await client.query(`UPDATE alert_decisions SET alert_status='NOTIFIED',first_notified_at=COALESCE(first_notified_at,now()),
    last_notified_at=now(),notification_count=notification_count+1 WHERE alert_id=$1`, [alert.alert_id]);
  return 1;
}

export async function processRunAlerts(client, runId, { deliver = true, reportsRoot = runtimePaths.reportDir } = {}) {
  const profile = await getProfile(client);
  const { rows } = await client.query(`SELECT ev.*,o.*,e.company_name
    FROM opportunity_change_events ev JOIN opportunities o USING(opportunity_id)
    JOIN employers e USING(employer_id) WHERE ev.run_id=$1 ORDER BY ev.event_id`, [runId]);
  let generated = 0; let delivered = 0; const decisions = [];
  for (const row of rows) {
    const event = { event_id: row.event_id, event_type: row.event_type, detected_at: row.detected_at,
      previous_state: row.previous_state, new_state: row.new_state };
    const { decision, alert } = await persistAlertDecision(client, event, row, profile);
    decisions.push(decision);
    if (alert) {
      generated++;
      if (deliver) delivered += await deliverLocal(client, alert, reportsRoot);
    }
  }
  return { generated, delivered, decisions };
}

function healthType(fetch) {
  if (fetch.http_status === 429) return 'HTTP_429';
  if (fetch.http_status === 403) return 'HTTP_403';
  if (/tls|certificate|cert_/i.test(`${fetch.error_class} ${fetch.error_message}`)) return 'TLS_FAILURE';
  if (/parse|json|syntax/i.test(`${fetch.error_class} ${fetch.error_message}`)) return 'PARSER_FAILURE';
  return fetch.success ? null : 'SOURCE_DOWN';
}

export async function processRunHealth(client, runId) {
  const { rows } = await client.query(`SELECT mf.*,ms.consecutive_errors,ms.source_name,ms.adapter,prior.jobs_found AS previous_jobs_found
    FROM monitoring_fetches mf JOIN monitored_sources ms USING(monitored_source_id)
    LEFT JOIN LATERAL (SELECT p.jobs_found FROM monitoring_fetches p
      WHERE p.monitored_source_id=mf.monitored_source_id AND p.fetch_id<mf.fetch_id AND p.success
      ORDER BY p.fetch_id DESC LIMIT 1) prior ON TRUE
    WHERE mf.run_id=$1`, [runId]);
  const massFailure = rows.length > 0 && rows.filter(x => !x.success).length / rows.length >= 0.25;
  let generated = 0; const events = [];
  for (const fetch of rows) {
    let type = healthType(fetch);
    if (!type && fetch.success && fetch.jobs_found === 0 && fetch.previous_jobs_found >= 3) type = 'ZERO_RESULTS_ANOMALY';
    if (!type) continue;
    const escalated = massFailure || Number(fetch.consecutive_errors) >= 3 || ['TLS_FAILURE','PARSER_FAILURE'].includes(type) && Number(fetch.consecutive_errors) >= 2;
    const severity = massFailure ? 'CRITICAL' : escalated ? 'WARNING' : 'INFO';
    const details = type === 'HTTP_429'
      ? 'Rate limited. No bypass attempted; source backoff applies.'
      : `${fetch.error_message || `HTTP ${fetch.http_status || 'failure'}`} (${fetch.source_name})`;
    const inserted = await client.query(`INSERT INTO source_health_events
      (fetch_id,monitored_source_id,run_id,health_type,severity,consecutive_failures,escalated,details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fetch_id) DO NOTHING RETURNING *`,
      [fetch.fetch_id,fetch.monitored_source_id,runId,type,severity,fetch.consecutive_errors,escalated,details]);
    if (inserted.rowCount) { generated++; events.push(inserted.rows[0]); }
  }
  return { generated, events, massFailure };
}

const mdLink = (label, url) => url ? `[${clean(label)}](${url})` : clean(label);
const listOrNone = rows => rows.length ? rows.map(x => `- ${x}`).join('\n') : '- None';

export async function generateDailyDigest(client, { date, reportsRoot = runtimePaths.reportDir } = {}) {
  const profile = await getProfile(client);
  const digestDate = date || new Intl.DateTimeFormat('en-CA',{timeZone:profile.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const bounds = (await client.query(`SELECT ($1::date::timestamp AT TIME ZONE $2) AS start,
    (($1::date+1)::timestamp AT TIME ZONE $2) AS finish`, [digestDate,profile.timezone])).rows[0];
  const { rows: events } = await client.query(`SELECT ev.event_type,ev.detected_at,o.*,e.company_name,mr.run_mode
    FROM opportunity_change_events ev LEFT JOIN opportunities o USING(opportunity_id)
    LEFT JOIN employers e USING(employer_id) JOIN monitoring_runs mr USING(run_id)
    WHERE ev.detected_at >= $1 AND ev.detected_at < $2 ORDER BY ev.detected_at DESC`, [bounds.start,bounds.finish]);
  const relevantCandidates = events.filter(x => ['NEW_JOB','STUDENT_ROLE_ADDED'].includes(x.event_type)
    && ['EXCEPTIONAL_MATCH','STRONG_MATCH'].includes(x.latent_fit_class) && Number(x.technical_match || 0) > 0);
  const seenNew = new Set();
  const relevantNew = relevantCandidates.filter(x => {
    if (!x.opportunity_id || seenNew.has(String(x.opportunity_id))) return false;
    seenNew.add(String(x.opportunity_id)); return true;
  });
  const changed = events.filter(x => x.opportunity_id && /CHANGED$/.test(x.event_type));
  const closed = events.filter(x => ['JOB_CLOSED','JOB_REMOVED'].includes(x.event_type));
  const { rows: failures } = await client.query(`SELECT DISTINCT e.company_name,ms.source_name,mf.http_status,mf.error_class
    FROM monitoring_fetches mf JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id)
    WHERE mf.fetched_at >= $1 AND mf.fetched_at < $2 AND NOT mf.success ORDER BY e.company_name`, [bounds.start,bounds.finish]);
  const { rows: best } = await client.query(`WITH ranked AS (
    SELECT e.company_name,o.*,row_number() OVER(PARTITION BY o.employer_id ORDER BY o.opportunity_priority DESC NULLS LAST) employer_rank
    FROM opportunities o JOIN employers e USING(employer_id) WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT')
    SELECT * FROM ranked WHERE employer_rank<=2 ORDER BY opportunity_priority DESC NULLS LAST LIMIT 7`);
  const { rows: actionable } = await client.query(`SELECT count(*)::int n FROM alert_decisions
    WHERE created_at >= $1 AND created_at < $2 AND priority IN('P0','P1')`, [bounds.start,bounds.finish]);
  const actionRequired = actionable[0].n > 0;
  const important = relevantNew.length + changed.length + closed.length > 0;
  const lines = [`# Daily opportunity digest — ${digestDate}`,'',
    `Profile: ${profile.current_status}; enrollment ${profile.enrollment_status}; German ${profile.german_level} → ${profile.target_german_level}.`,''];
  if (!important) lines.push('## NO HIGH-VALUE CHANGE TODAY.','');
  lines.push('## 1. Genuinely new relevant opportunities','',listOrNone(relevantNew.slice(0,10).map(x =>
    `${x.company_name}: ${mdLink(x.title,x.job_url)} — ${x.latent_fit_class}, ${effectiveEligibility(x,profile)}${x.run_mode==='BASELINE'?' (baseline discovery)':''}`)),'',
    '## 2. Material changes','',listOrNone(changed.slice(0,10).map(x => `${x.company_name}: ${x.title} — ${x.event_type}`)),'',
    '## 3. Closed or removed','',listOrNone(closed.slice(0,10).map(x => `${x.company_name}: ${x.title} — ${x.event_type}`)),'',
    '## 4. Source failures','',listOrNone(failures.map(x => `${x.company_name}: ${x.source_name} — ${x.http_status || x.error_class}`)),'',
    '## 5. Best opportunities currently available','',listOrNone(best.map(x =>
      `${x.company_name}: ${mdLink(x.title,x.job_url)} — latent ${x.latent_fit_class}; eligibility ${effectiveEligibility(x,profile)}`)),'',
    '## 6. What Faizan should do today','',actionRequired
      ? '- Review the P0/P1 alert files generated today.'
      : '- No immediate application action. Preserve the strongest future opportunities and prepare for enrollment.','');
  const content = lines.join('\n');
  await fs.mkdir(reportsRoot,{recursive:true});
  const outputPath = path.join(reportsRoot,`daily_digest_${digestDate}.md`);
  await fs.writeFile(outputPath,content,'utf8');
  await client.query(`INSERT INTO daily_digest_runs
    (digest_date,timezone,window_start,window_end,high_value_new_count,changed_count,closed_count,source_failure_count,action_required,output_path,content_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(digest_date,timezone) DO UPDATE SET generated_at=now(),window_start=EXCLUDED.window_start,
      window_end=EXCLUDED.window_end,high_value_new_count=EXCLUDED.high_value_new_count,changed_count=EXCLUDED.changed_count,
      closed_count=EXCLUDED.closed_count,source_failure_count=EXCLUDED.source_failure_count,
      action_required=EXCLUDED.action_required,output_path=EXCLUDED.output_path,content_hash=EXCLUDED.content_hash`,
    [digestDate,profile.timezone,bounds.start,bounds.finish,relevantNew.length,changed.length,closed.length,failures.length,actionRequired,outputPath,hash(content)]);
  return { digestDate, outputPath, content, highValueNew: relevantNew.length, changed: changed.length,
    closed: closed.length, failures: failures.length, actionRequired };
}

export function createPool() { return new Pool(poolConfig); }

async function cli() {
  const runArg = process.argv.find(x => x.startsWith('--run-id='));
  const digestOnly = process.argv.includes('--digest-only');
  const pool = createPool(); const client = await pool.connect();
  try {
    const runId = runArg ? Number(runArg.split('=')[1]) : (await client.query('SELECT max(run_id)::int id FROM monitoring_runs')).rows[0].id;
    const alertResult = digestOnly ? {generated:0,delivered:0} : await processRunAlerts(client,runId);
    const healthResult = digestOnly ? {generated:0,events:[]} : await processRunHealth(client,runId);
    const digest = await generateDailyDigest(client);
    console.log(JSON.stringify({runId,alerts:alertResult,health:healthResult,digest:{...digest,content:undefined}},null,2));
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch(error => { console.error(error); process.exitCode=1; });
}
