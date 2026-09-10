# Employer Intelligence Database

## Milestone 1 audited decision surface (2026-08-30)

The first 100 employers have been quality-audited. Use the audited views rather
than the original score alone:

- `v_audited_top20`
- `v_verified_opportunities_right_now`
- `v_audited_active_employers`
- `v_quarantined_employers`

The original 100 records are preserved for provenance. `WEAK` and `REMOVE`
records are quarantined from the active view. The separate `university_units`
table maps the Universität zu Lübeck internal HiWi market.

To apply or reapply the audit after loading the original seed:

```powershell
$env:PGPASSWORD='<your local password>'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h localhost -d faizan_employer_intelligence -f db\load_audit.sql
```

See `reports/milestone1_quality_audit_2026-08-30.md` for the findings and action
plan. Do not expand the employer universe until this audited shortlist has been
used for applications and monitoring.

## Phase 2A: opportunity monitoring

The tested monitoring layer currently covers the six S-tier targets using 26
official public sources. Universität zu Lübeck is monitored through separate
institute/group sources rather than one central careers page.

Install/reapply the monitoring schema and source catalog:

```powershell
$env:PGPASSWORD='<your local password>'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h localhost -d faizan_employer_intelligence -f db\load_monitoring.sql
```

Run due checks and regenerate the monitoring report:

```powershell
$env:PGPASSWORD='<your local password>'
.\monitor\run-s-tier-monitor.ps1 -Mode MANUAL
```

Use `-Force -Mode TEST` only for validation. Normal runs respect the source
cadences stored in `monitored_sources`. Set `FAIZAN_ENROLLED=true` only after
enrollment is factually complete; otherwise student roles remain future market
signals and never produce apply-now urgency.

No database password is stored in the repository, and no scheduled Windows task
is installed automatically. The monitor uses a descriptive user agent, runs
sequentially, and does not bypass TLS, authentication, CAPTCHAs, or access
controls.

Monitoring views:

- `v_monitoring_new_since_last_check`
- `v_best_current_monitored_matches`
- `v_monitoring_future_signals`
- `v_monitoring_closed_since_last_check`
- `v_monitoring_high_value_page_changes`
- `v_monitoring_university_changes`

## Phase 2B: Tier-A expansion

- `db/monitoring_seed_a_tier.sql` records the employer-by-employer official-source audit and configures 35 Tier-A sources.
- `monitor/run-tier-a-monitor.ps1` runs due Tier-A sources; use `-Force -Mode TEST` only for deliberate validation.
- `monitor/generate-phase2b-report.js` produces the coverage, opportunity, health, hiring-intelligence, and combined S+A report.
- Tier-A validation passed with clean baseline run 20 and forced repeat run 21: 51 observations and zero repeat events. The run remains `PARTIAL` because FREENOW's corporate careers page returns HTTP 429; no access control was bypassed.
- At the Phase 2B stop point, Phase 2C had not yet been started. No Phase 2D employer expansion, application, CV, interview, or dashboard layer is included.

## Phase 2C: automation and intelligent alerts

Apply the additive migration with `db/load_phase2c.sql`. The Phase 2C runner
records scheduling telemetry, uses PostgreSQL advisory locks to prevent overlap,
respects source cadences/backoff, evaluates change events into P0–P3 decisions,
stores infrastructure health separately, and writes a compact daily Markdown
digest.

```powershell
$env:PGPASSWORD='<your local password>'
.\monitor\run-automated-monitor.ps1 -Tiers S -Trigger MANUAL
```

The proposed scheduler is deliberately inactive. Preview it with
`.\scheduler\register-phase2c-schedule.ps1`; registration requires both explicit
approval and the `-Activate` switch. It proposes Tier S at 00:00/08:00/16:00 and
Tier A at 06:00/18:00 in the Windows task scheduler's local timezone. The task
uses `IgnoreNew`, while the runner also uses database advisory locks.

Profile state is centralized in `monitoring_profile` and can be updated without
rebuilding monitoring, for example:

```powershell
node .\monitor\update-profile.js --enrollment-status=ENROLLED --german-level=B1
```

External email, Telegram, and desktop channels are not enabled and no credential
is stored. Local terminal and Markdown delivery work without paid infrastructure.

## Phase 2D: personal opportunity ranking

Apply `db/load_phase2d.sql`, then run `npm run rank` from `monitor`. The
explainable model stores separate 0–100 latent-fit and actionability scores,
component evidence, hard/temporary/soft blockers, and four scenario results.
The real monitoring profile is never mutated by scenario calculation.

Ranking views:

- `v_top_current_actionable`
- `v_top_future`
- `v_top_10_overall`
- `v_top_backend`, `v_top_data`, `v_top_gis`, `v_top_security`
- `v_top_student`, `v_top_english_friendly`

Monitoring and profile-update commands recalculate rankings automatically after
the Phase 2D migration is installed. No dashboard, AWS deployment, application,
CV, interview, outreach, or automatic-application layer is included.

## Phase 2E: historical employer intelligence

Apply `db/load_phase2e.sql`, then run `npm run history` from `monitor`. The
historical refresh reconstructs canonical opportunity lifecycles, preserves
Phase 2D score states, calculates separate employer activity/fit/history/watch
scores, and aggregates vacancy-supported role-family, technology, and language
evidence. One append-only market snapshot is attempted per calendar date.

Baseline observations establish visibility only. They are excluded from
post-baseline recency and recent-activity signals and never become official
posting dates. Closures require a valid closure event; a temporary source failure
cannot close a role. Because the present observation window is short, the views
correctly expose `INSUFFICIENT_DATA` rather than manufacturing trends.

Run `npm run test:phase2e` for the 12 integrity checks and
`npm run report:phase2e` for the conservative historical report. Scheduled
monitoring and profile updates refresh Phase 2E automatically after ranking.

## Phase 2F: production deployment preparation

The provider-neutral Ubuntu bundle is in `production/`. It uses systemd timers
for Tier S three times daily and Tier A twice daily, retains PostgreSQL advisory
locks and per-source backoff, writes redacted structured logs, performs daily
database archives and weekly full restore verification, and supplies a
three-state health command.

Read `production/RUNBOOK.md` before deployment. Copy
`config/production.example.env` to the protected host configuration path and
replace its placeholder; never commit the populated file. Useful commands from
`monitor` are `npm run health`, `npm run backup -- --restore-verify`,
`npm run test:dr`, and `npm run test:phase2f`. Phase 2F provisions no cloud
resource and deploys no dashboard or public endpoint.

Canonical PostgreSQL database: `faizan_employer_intelligence`

For a scheduler-free Linux application installation, use
`APPLICATION_DEPLOYMENT.md`. The repository pins Node.js 24.18.0 and npm
11.16.0; runtime database credentials come only from environment variables.

The database was created on the local PostgreSQL 18 server and is isolated from the default `postgres` database. Credentials are intentionally not stored in this repository.

## Contents

- `employers`: 100 scored employer records with location, commute, technical relevance, student hiring, language, work model, career infrastructure, priority, confidence, and fact/inference notes.
- `sources`: one auditable discovery/evidence source per employer, including source type, check date, primary/stale flags, and evidence summary.
- `opportunities`: live and historical vacancy layer, separate from durable employer records.
- `research_queue`: next action, research gap, monitoring cadence, and next check date.

## Most useful views

- `v_attack_now`
- `v_top_25`
- `v_luebeck_targets`
- `v_hamburg_targets`
- `v_smaller_city_hidden_gems`
- `v_backend_targets`
- `v_data_database_targets`
- `v_gis_targets`
- `v_security_targets`
- `v_english_b1_targets`
- `v_student_hiring_machines`
- `v_high_value_monitoring`
- `v_current_opportunities`
- `v_low_confidence_targets`

## Connect

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d faizan_employer_intelligence
```

## Useful queries

```sql
SELECT * FROM v_attack_now;
SELECT * FROM v_top_25;
SELECT * FROM v_current_opportunities;
SELECT * FROM v_luebeck_targets;
SELECT * FROM v_gis_targets LIMIT 25;
SELECT * FROM v_high_value_monitoring;
SELECT * FROM research_queue WHERE status = 'Open' ORDER BY next_check_date;
```

## Rebuild

Run the SQL files in this order against a fresh `faizan_employer_intelligence` database:

1. `db/schema.sql`
2. `db/seed_core.sql`
3. `db/load_seed.sql`
4. `db/seed_expansion.sql`
5. `db/load_seed.sql`
6. `db/opportunities.sql`
7. `db/views.sql`
8. `db/data_corrections.sql`

All hiring evidence was checked on `2026-08-30`. A source can remain useful for employer discovery even when `is_stale = true`; stale evidence must not be treated as a current vacancy.

## Private dashboard

The additive Next.js dashboard lives in `dashboard/`. See `dashboard/README.md` for its read-only architecture, local setup, existing-data mappings, and unexecuted production deployment plan.
