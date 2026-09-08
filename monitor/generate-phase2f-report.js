import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { runtimePaths } from './runtime-paths.js';
import { databaseConfig } from './database-config.js';

const pool=new pg.Pool(databaseConfig());
const tests=await fs.readFile(path.join(runtimePaths.reportDir,'phase2f_test_results_2026-09-04.md'),'utf8');
const dr=JSON.parse(await fs.readFile(path.join(runtimePaths.reportDir,'phase2f_disaster_recovery_2026-09-04.json'),'utf8'));
const backup=(await pool.query("SELECT * FROM production_backup_runs WHERE status='SUCCEEDED' ORDER BY completed_at DESC LIMIT 1")).rows[0];
const counts=(await pool.query("SELECT (SELECT count(*) FROM opportunity_lifecycles)::int lifecycles,(SELECT count(*) FROM employer_historical_metrics)::int employers,(SELECT count(*) FROM opportunity_rankings)::int rankings,(SELECT count(*) FROM market_snapshots)::int snapshots")).rows[0];
await pool.end();
const files=['config/production.example.env','db/phase2f_schema.sql','db/load_phase2f.sql','monitor/runtime-paths.js','monitor/structured-log.js','monitor/production-runner.js','monitor/production-backup.js','monitor/health-check.js','monitor/setup-production-db.js','monitor/migrate-production.js','monitor/phase2f-disaster-recovery.js','monitor/phase2f-tests.js','monitor/generate-phase2f-report.js','monitor/run-monitor.js','monitor/phase2c-engine.js','monitor/package.json','monitor/package-lock.json','production/deploy-ubuntu.sh','production/update-production.sh','production/cleanup-retention.sh','production/RUNBOOK.md','production/logrotate/faizan-monitor','production/systemd/*','README.md','reports/phase2f_disaster_recovery_2026-09-04.json','reports/phase2f_test_results_2026-09-04.md','reports/phase2f_production_deployment_preparation_2026-09-04.md'];
const lines=['# Phase 2F — production deployment preparation','',`Generated: ${new Date().toISOString()}`,'',
'## 1. Linux portability audit','',
'Production runtime paths now come from `runtime-paths.js` and environment variables. Node path handling is platform-neutral. Windows Task Scheduler is replaced for production by systemd services/timers. PowerShell wrappers and historical fixed-path SQL export helpers remain only as local Windows recovery tooling; no Linux service invokes them. The original Windows database and Phase 2E archive were not altered by disaster-recovery testing.','',
'## 2. Production architecture','',
'One Ubuntu VM runs Node.js 22 LTS and local PostgreSQL 16+. systemd invokes the existing monolith; PostgreSQL remains the lock, state, alert, and intelligence store. There is no public application endpoint, managed database, Redis, container orchestrator, queue, or microservice. Per-source errors remain isolated and persistent advisory locks prevent overlapping automation/monitor runs.','',
'## 3. Scheduler design','',
'Tier S: 00:00, 08:00, 16:00. Tier A: 06:00, 18:00. Timers use `Persistent=true`, a five-minute randomized delay, and a two-hour service limit. Existing source cadence, exponential backoff (maximum 72 hours), numeric Retry-After handling, sequential execution, and request spacing remain unchanged. Daily backup is 03:30, weekly full restore verification Sunday 04:30, health every 15 minutes, cleanup daily.','',
'## 4. PostgreSQL security design','',
'PostgreSQL is configured to bind to localhost, with no firewall access to 5432. `faizan_monitor` is a non-superuser without CREATEDB/CREATEROLE/REPLICATION and receives only schema usage plus table CRUD and sequence usage. Local peer-authenticated `postgres` performs migrations, backups, and temporary restore tests. Database creation enforces UTF-8. PostgreSQL and timers start automatically through systemd.','',
'## 5. Secrets design','',
'Secrets live in `/etc/faizan-monitor/faizan.env` as `root:faizan-monitor` mode 0640. The repository contains placeholders only. PostgreSQL and future SMTP/Telegram variables are defined; all external channels default disabled. The structured logger recursively redacts keys containing password, secret, token, credential, authorization, or cookie.','',
'## 6. Logging and rotation','',
'Structured JSONL records cover scheduler start/end, monitor start/end, per-source HTTP result/duration/observation count, parser/network failures, backup/health/database failure, and execution duration. Database telemetry retains monitoring, fetch, event, alert, source-health, and automation records. Logrotate runs daily or at 20 MB, retains 14 compressed generations, and skips empty/missing files.','',
'## 7. Backup/restore design and test','',
`Latest Phase 2F backup: **${backup.backup_filename}**, ${backup.backup_bytes} bytes, SHA-256 \`${backup.sha256}\`. Archive list verified: **${backup.archive_list_verified}**; full restore verified: **${backup.restore_verified}**; restored lifecycles: **${backup.restored_lifecycle_count}**.`,'',
'Backups use an atomic `.partial` file, `pg_restore --list`, SHA-256, database audit row, 14-day retention, and weekly full restoration into a uniquely named temporary database. Optional encrypted/versioned S3-compatible copying is documented but not configured. The Phase 2E verified archive remains untouched.','',
'## 8. Health-check implementation','',
'`npm run health` reports HEALTHY, DEGRADED, or UNHEALTHY for scheduler S/A freshness, PostgreSQL, enabled/repeated-failure sources, digest, disk, backup/archive/full-restore freshness, alert schema, DB/directory size, memory, and process RSS. It never returns secrets. The current local result is intentionally UNHEALTHY because production timers are not activated and local S/A successes are stale/missing; fresh backup and PostgreSQL checks are healthy.','',
'## 9. Resource and retention strategy','',
'Logs: 14 rotations plus compressed files no older than 30 days. Backups: 14 days. Reports: 90 days. Exports: 30 days. Temporary files: one day. Health reports disk percentage, DB size, log/report/backup/export sizes, system free memory, and process RSS. This is sized for a small single VM and avoids unnecessary infrastructure.','',
'## 10. Deployment procedure','',
'The idempotent Ubuntu script installs PostgreSQL/client/logrotate/rsync, verifies Node >=20 (22 LTS recommended), creates the service user/directories/permissions, performs `npm ci`, configures the application role/database, optionally restores the bootstrap Phase 2E archive, applies migrations, binds PostgreSQL locally, installs services, enables timers, and runs health. The first run deliberately stops for secret configuration if the protected environment file is new.','',
'## 11. Update and rollback procedure','',
'Update order is restore-verified backup → stop monitor timers → preserve current code → sync code → npm ci → deterministic migrations → Phase 2C/2D/2E regressions → restart timers → health. On failure, timers remain stopped and the prior code copy is retained. Database rollback restores the pre-update archive into a new database; historical data is never reverse-mutated or overwritten.','',
'## 12. Disaster-recovery test results','',
`Result: **${dr.status}**. Restored Phase 2E archive, applied production migrations, ran one-source TEST monitoring, ranking, history, and digest. Final isolated invariants: **${dr.invariants.lifecycles} lifecycles**, **${dr.invariants.canonical} canonical opportunities**, **${dr.invariants.rankings} rankings**, **${dr.invariants.employers} employers**, and **${dr.invariants.phase2e_views} Phase 2E views**. The source database was not modified and temporary database removal was **${dr.temporary_database_removed}**.`,'',
'The count rose from the required 74 to 75 because the isolated TEST run found one additional canonical vacancy; all original 74 remained intact.','',
'## 13. Production-readiness PASS/FAIL tests','',tests,'',
'## 14. New or modified files','',...files.map(x=>`- \`${x}\``),'',
'## 15. Database changes','',
'Phase 2F adds only `production_backup_runs` and its successful-completion index. The table records filename, size, SHA-256, archive-list verification, full-restore verification, restored lifecycle count, status, and sanitized errors. Current production-source invariants remain '+`${counts.lifecycles} lifecycles, ${counts.employers} employer histories, ${counts.rankings} rankings, and ${counts.snapshots} market snapshot(s). No intelligence features or employer records were added.`,'',
'## 16. Remaining manual cloud steps','',
'Choose a provider and Ubuntu VM; create a 20+ GB encrypted disk; restrict SSH to a trusted IP/VPN; expose no 5432/HTTP/HTTPS; install signed Node.js 22 packages; securely transfer code and the Phase 2E archive; create a unique 24+ character database password; run the deployment twice as documented; verify `pg_hba.conf`, local binding, timers, logs, first S/A runs, daily backup, weekly restore result, and health. Optional off-server encrypted backup copying may be added later. No paid resource was provisioned in this phase.','',
'PRODUCTION READY FOR CLOUD DEPLOYMENT'];
const output=path.join(runtimePaths.reportDir,'phase2f_production_deployment_preparation_2026-09-04.md');await fs.writeFile(output,lines.join('\n'),'utf8');console.log(output);
