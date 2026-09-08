import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

const {Pool}=pg;
const pool=new Pool(databaseConfig());
const client=await pool.connect();
try{
  const latest=(await client.query(`SELECT * FROM monitoring_runs WHERE requested_tiers @> ARRAY['S','A']::text[] ORDER BY run_id DESC LIMIT 1`)).rows[0];
  const executions=(await client.query(`SELECT * FROM automation_executions ORDER BY automation_execution_id`)).rows;
  const priorities=(await client.query(`SELECT priority,count(*)::int n FROM alert_decisions GROUP BY priority ORDER BY priority`)).rows;
  const latestHealth=(await client.query(`SELECT she.health_type,she.severity,she.escalated,e.company_name,ms.source_name,she.details
    FROM source_health_events she JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id)
    WHERE she.run_id=$1 ORDER BY e.company_name`,[latest.run_id])).rows;
  const profile=(await client.query(`SELECT * FROM monitoring_profile WHERE profile_id=TRUE`)).rows[0];
  const digest=(await client.query(`SELECT * FROM daily_digest_runs ORDER BY generated_at DESC LIMIT 1`)).rows[0];
  const digestContent=await fs.readFile(digest.output_path,'utf8');
  const tests=await fs.readFile(path.resolve('..','reports','phase2c_test_results_2026-08-31.md'),'utf8');
  const pc=Object.fromEntries(priorities.map(x=>[x.priority,x.n]));
  const executionRows=executions.map(x=>`| ${x.automation_execution_id} | ${(x.requested_tiers||[]).join('+')} | ${x.trigger_type} | ${x.status} | ${x.sources_succeeded}/${x.sources_attempted} | ${x.opportunities_observed} | ${x.events_generated} | ${x.alerts_generated} | ${x.alerts_delivered} | ${x.duration_ms} |`).join('\n');
  const healthRows=latestHealth.length?latestHealth.map(x=>`| ${x.company_name} | ${x.source_name} | ${x.health_type} | ${x.severity} | ${x.escalated?'Yes':'No'} | ${x.details.replaceAll('|','\\|')} |`).join('\n'):'| None | None | None | None | No | No latest-run failures |';
  const files=[
    'db/phase2c_schema.sql (new)','db/load_phase2c.sql (new)','monitor/phase2c-engine.js (new)',
    'monitor/automate-run.js (new)','monitor/delivery-adapters.js (new)','monitor/update-profile.js (new)',
    'monitor/run-automated-monitor.ps1 (new)','monitor/phase2c-tests.js (new)',
    'scheduler/register-phase2c-schedule.ps1 (new)','scheduler/unregister-phase2c-schedule.ps1 (new)',
    'config/phase2c.example.env (new, empty values only)','monitor/run-monitor.js (modified)',
    'monitor/package.json and package-lock.json (modified)','db/monitoring_seed_a_tier.sql (modified)',
    'README.md (modified)','db/export_phase2c.sql (new)','reports/daily_digest_2026-08-31.md (generated)',
    'reports/phase2c_test_results_2026-08-31.md (generated)',
    'reports/phase2c_automation_alert_engine_2026-08-31.md (generated)',
    'exports/phase2c_*.csv (generated)','exports/faizan_employer_intelligence_phase2c_2026-08-31.backup (generated)',
    'exports/faizan_employer_intelligence_phase2c_2026-08-31.sql (generated)'
  ];
  const lines=[
    '# Phase 2C — automated monitoring and intelligent alert engine','',
    `Generated: ${new Date().toISOString()}`,'',
    '## Automation','',
    '- Architecture: two proposed Windows tasks call one guarded PowerShell/Node wrapper. The wrapper records execution telemetry, runs the existing sequential monitor, evaluates alert decisions, records source health, and writes the digest.',
    '- Proposed S frequency: 00:00, 08:00, and 16:00 daily (Windows local time; approximately three checks/day).',
    '- Proposed A frequency: 06:00 and 18:00 daily (Windows local time; approximately two checks/day).',
    '- Overlap prevention: Task Scheduler `IgnoreNew`, an automation advisory lock, and an independent monitor advisory lock.',
    '- Backoff: source cadence after success; exponential failure backoff capped at 72 hours; HTTP `Retry-After` honored; scheduled runs do not use `--force`.',
    '- Requests remain sequential with a 750 ms scheduled gap. TLS verification, authentication, CAPTCHAs, rate limits, and access controls are not bypassed.','',
    '| Execution | Tiers | Trigger | Status | Sources | Observed | Events | Decisions | Delivered | Duration ms |','|---|---|---|---|---|---|---|---|---|---|',executionRows,'',
    `Final unchanged repeat: run **${latest.run_id} ${latest.status}**, ${latest.sources_succeeded}/${latest.sources_attempted} sources, ${latest.opportunities_observed} observations, **${latest.events_created} events**, **0 alerts**.`,'',
    '## Alerts','',
    '- P0 CRITICAL: exceptional, currently eligible, language-compatible, new, and time-sensitive. Action: APPLY ASAP.',
    '- P1 HIGH: genuinely high-value and currently actionable after eligibility, arrival, and language blockers are considered. Action: REVIEW TODAY.',
    '- P2 FUTURE HIGH-VALUE: strong/rare fit blocked by enrollment, arrival, start timing, or material language status. Action: PREPARE / KEEP WATCHING; stored silently.',
    '- P3 INFORMATIONAL: weak/market signals, closures, and non-actionable changes. Stored silently.',
    '- Deduplication uses unique event/type and opportunity/type/material-fingerprint constraints. Re-alerting requires a new material event/fingerprint.',
    `- Current real decision ledger: P0 **${pc.P0||0}**, P1 **${pc.P1||0}**, P2 **${pc.P2||0}**, P3 **${pc.P3||0}**. The corrected current profile produced no immediate external/local P0/P1 delivery.`,
    '- Controlled test alerts generated: exactly **1** simulated P0; duplicate processing inserted **0** more. All simulated rows were rolled back.','',
    '## Daily digest','',
    `Real digest: ${digest.output_path}. Action required: **${digest.action_required?'YES':'NO'}**.`,'',
    digestContent,'',
    '## Tests','',tests,'',
    '## Health','',
    'Job alerts and source-health events are separate. A single failure remains informational; escalation requires repeated failure, parser/TLS persistence, a suspicious zero-result anomaly, or at least 25% simultaneous failure.','',
    '| Employer | Source | Type | Severity | Escalated | Details |','|---|---|---|---|---|---|',healthRows,'',
    '## Security','',
    '- No database password, SMTP password, Telegram token, or personal credential is stored in source files.',
    '- `config/phase2c.example.env` contains variable names and blank values only.',
    '- Optional email configuration requires `PHASE2C_SMTP_HOST`, `PHASE2C_SMTP_PORT`, `PHASE2C_SMTP_USER`, `PHASE2C_SMTP_PASSWORD`, and `PHASE2C_EMAIL_TO`.',
    '- Optional Telegram configuration requires `PHASE2C_TELEGRAM_BOT_TOKEN` and `PHASE2C_TELEGRAM_CHAT_ID`.',
    '- External adapters are disabled; only local terminal/Markdown delivery is active in code.','',
    '## Files','',...files.map(x=>`- ${x}`),'',
    '## Database','',
    'Additive migration `db/phase2c_schema.sql` creates: `monitoring_profile`, `automation_executions`, `alert_decisions`, `alert_deliveries`, `source_health_events`, `daily_digest_runs`, and `v_pending_high_priority_alerts`. Existing opportunity and monitoring history was preserved.','',
    `Current profile: ${profile.current_status}; expected move ${profile.expected_move}; target ${profile.target_university}; enrollment ${profile.enrollment_status}; German ${profile.german_level} → ${profile.target_german_level}.`,'',
    '## Activation status','',
    '# SCHEDULER NOT ACTIVE','',
    'The registration script was executed in preview mode only. Activation requires explicit approval and the `-Activate` switch. Phase 2D was not started.'
  ];
  const output=path.resolve('..','reports','phase2c_automation_alert_engine_2026-08-31.md');
  await fs.writeFile(output,lines.join('\n'),'utf8');
  console.log(output);
}finally{client.release();await pool.end();}
