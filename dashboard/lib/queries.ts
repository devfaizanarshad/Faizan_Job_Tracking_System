import { statfs } from "node:fs/promises";
import os from "node:os";
import { query, safeQuery } from "./db";
import type { RankedOpportunity, Status } from "./types";

export const dynamic = "force-dynamic";

const opportunitySelect = `
  SELECT o.opportunity_id::text,e.company_name,o.title,o.location,o.opportunity_type,o.role_family,
    o.work_model,o.job_url,o.status,o.eligibility_status,o.language_bucket,o.language_requirement,
    o.first_seen_at,o.last_seen_at,o.missing_requirements,o.role_description,o.technical_requirements,
    o.preferred_requirements,o.enrollment_requirement,o.alert_class,
    r.latent_fit_score,r.actionability_score,r.overall_score,r.primary_track,r.blockers,r.soft_gaps,
    r.explanation,r.component_breakdown
  FROM opportunities o JOIN employers e USING(employer_id)
  LEFT JOIN opportunity_rankings r USING(opportunity_id)`;

type Snapshot = { captured_at: string; total_live_opportunities: number; relevant_live_opportunities: number; strong_live_opportunities: number; student_live_opportunities: number };
type Run = { run_id: string; finished_at: string; status: string; requested_tiers: string[]; sources_attempted: number; sources_succeeded: number; opportunities_observed: number; events_created: number };
type SourceSummary = { enabled: number; healthy: number; repeated_failures: number; failing: number };
type Backup = { completed_at: string | null; restore_verified_at: string | null; status: string | null };

const hoursSince = (value: string | null | undefined) => value ? (Date.now() - new Date(value).getTime()) / 3_600_000 : Infinity;
const freshness = (value: string | null | undefined, healthyHours: number): Status => {
  const age = hoursSince(value);
  return age <= healthyHours ? "healthy" : age <= healthyHours * 2 ? "degraded" : "down";
};

export function actionLabel(opportunity: Pick<RankedOpportunity, "blockers" | "actionability_score" | "eligibility_status">) {
  const blockers = Array.isArray(opportunity.blockers) ? opportunity.blockers : [];
  const hasHardBlocker = blockers.some((item) => typeof item === "object" && item && ["HARD", "TEMPORARY"].includes(String((item as { severity?: string }).severity)));
  if (hasHardBlocker) return opportunity.eligibility_status?.includes("ENROLL") ? "Future" : "Blocked";
  const actionability = Number(opportunity.actionability_score || 0);
  if (actionability >= 60) return "Apply now";
  if (actionability >= 25) return "Review";
  return "Watch";
}

export async function getOverview() {
  const [snapshot, actions, activity, sources, sRun, aRun, backup, alertEngine] = await Promise.all([
    safeQuery<Snapshot>("SELECT * FROM v_market_snapshot_latest"),
    safeQuery<RankedOpportunity>(`${opportunitySelect} WHERE o.status='LIVE' AND o.alert_class<>'NOT_RELEVANT' ORDER BY r.actionability_score DESC NULLS LAST,r.latent_fit_score DESC NULLS LAST,o.opportunity_id LIMIT 5`),
    getActivity(8),
    safeQuery<SourceSummary>(`SELECT count(*)::int enabled,count(*) FILTER(WHERE consecutive_errors=0)::int healthy,count(*) FILTER(WHERE consecutive_errors>=3)::int repeated_failures,count(*) FILTER(WHERE consecutive_errors>0)::int failing FROM monitored_sources WHERE enabled`),
    safeQuery<Run>("SELECT run_id::text,finished_at,status,requested_tiers,sources_attempted,sources_succeeded,opportunities_observed,events_created FROM monitoring_runs WHERE finished_at IS NOT NULL AND requested_tiers @> ARRAY['S']::text[] ORDER BY finished_at DESC LIMIT 1"),
    safeQuery<Run>("SELECT run_id::text,finished_at,status,requested_tiers,sources_attempted,sources_succeeded,opportunities_observed,events_created FROM monitoring_runs WHERE finished_at IS NOT NULL AND requested_tiers @> ARRAY['A']::text[] ORDER BY finished_at DESC LIMIT 1"),
    safeQuery<Backup>("SELECT completed_at,status,max(completed_at) FILTER(WHERE restore_verified) OVER() restore_verified_at FROM production_backup_runs WHERE status='SUCCEEDED' ORDER BY completed_at DESC LIMIT 1"),
    safeQuery<{ operational: boolean }>("SELECT to_regclass('public.alert_decisions') IS NOT NULL AND to_regclass('public.source_health_events') IS NOT NULL operational"),
  ]);

  const s = sRun.data[0];
  const a = aRun.data[0];
  const source = sources.data[0];
  const backupRow = backup.data[0];
  const checks = {
    sMonitor: freshness(s?.finished_at, 12),
    aMonitor: freshness(a?.finished_at, 18),
    database: snapshot.error ? "down" as Status : "healthy" as Status,
    alertEngine: alertEngine.data[0]?.operational ? "healthy" as Status : "down" as Status,
    backup: freshness(backupRow?.completed_at, 36),
  };
  const coreStates = Object.values(checks);
  const status: Status = coreStates.includes("down") ? "down" : coreStates.includes("degraded") || (source?.repeated_failures || 0) > 0 ? "degraded" : "healthy";

  return { snapshot, actions, activity, sources, runs: { s, a }, backup: backupRow, checks, status, checkedAt: new Date().toISOString() };
}

export async function getOpportunities(filter = "all", location = "", roleFamily = "") {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (filter === "closed") conditions.push("o.status<>'LIVE'");
  else conditions.push("o.status='LIVE'", "o.alert_class<>'NOT_RELEVANT'");
  if (filter === "strong") conditions.push("r.latent_fit_score>=70");
  if (filter === "student") conditions.push("(o.opportunity_type~*'Werkstudent|Working Student|Student|HiWi|Internship|Praktikum|Thesis' OR o.enrollment_requirement IS NOT NULL)");
  if (filter === "apply") conditions.push("r.actionability_score>=60", "NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.blockers,'[]'::jsonb)) b WHERE b->>'severity' IN ('HARD','TEMPORARY'))");
  if (filter === "future") conditions.push("EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.blockers,'[]'::jsonb)) b WHERE b->>'severity' IN ('HARD','TEMPORARY'))");
  if (location) { values.push(`%${location}%`); conditions.push(`o.location ILIKE $${values.length}`); }
  if (roleFamily) { values.push(roleFamily); conditions.push(`(o.role_family=$${values.length} OR r.primary_track=$${values.length})`); }
  return safeQuery<RankedOpportunity>(`${opportunitySelect} WHERE ${conditions.join(" AND ")} ORDER BY r.actionability_score DESC NULLS LAST,r.latent_fit_score DESC NULLS LAST,o.first_seen_at DESC LIMIT 200`, values);
}

export async function getOpportunity(id: string) {
  if (!/^\d+$/.test(id)) return { data: [] as RankedOpportunity[], error: "Invalid opportunity." };
  return safeQuery<RankedOpportunity>(`${opportunitySelect} WHERE o.opportunity_id=$1`, [id]);
}

export type ActivityItem = { id: string; occurred_at: string; kind: string; company_name: string | null; title: string | null; detail: string };
export async function getActivity(limit = 100, type = "all") {
  const typeCondition = type === "new" ? "AND ev.event_type IN ('NEW_JOB','STUDENT_ROLE_ADDED')" : type === "changed" ? "AND ev.event_type LIKE '%CHANGED'" : type === "closed" ? "AND ev.event_type IN ('JOB_CLOSED','JOB_REMOVED')" : "";
  const includeRuns = ["all"].includes(type);
  const includeErrors = ["all", "errors"].includes(type);
  const unions: string[] = [];
  if (type !== "errors") unions.push(`SELECT 'event-'||ev.event_id id,ev.detected_at occurred_at,ev.event_type kind,e.company_name,o.title,
    CASE ev.event_type WHEN 'NEW_JOB' THEN 'New opportunity detected' WHEN 'STUDENT_ROLE_ADDED' THEN 'Student opportunity detected' WHEN 'JOB_CLOSED' THEN 'Role closed' WHEN 'JOB_REMOVED' THEN 'Role removed' ELSE initcap(replace(ev.event_type,'_',' ')) END detail
    FROM opportunity_change_events ev LEFT JOIN opportunities o USING(opportunity_id) LEFT JOIN employers e ON e.employer_id=o.employer_id WHERE 1=1 ${typeCondition}`);
  if (includeRuns) unions.push(`SELECT 'run-'||run_id,finished_at,'MONITOR_COMPLETED',NULL,NULL,concat(array_to_string(requested_tiers,' + '),' monitor completed · ',sources_succeeded,'/',sources_attempted,' sources · ',events_created,' events') FROM monitoring_runs WHERE finished_at IS NOT NULL`);
  if (includeErrors) unions.push(`SELECT 'health-'||she.health_event_id id,COALESCE(she.resolved_at,she.detected_at) occurred_at,CASE WHEN she.resolved_at IS NULL THEN 'SOURCE_FAILED' ELSE 'SOURCE_RECOVERED' END kind,e.company_name,ms.source_name title,CASE WHEN she.resolved_at IS NULL THEN concat(initcap(replace(she.health_type,'_',' ')),' · ',she.consecutive_failures,' consecutive failures') ELSE 'Source recovered' END detail FROM source_health_events she JOIN monitored_sources ms USING(monitored_source_id) JOIN employers e USING(employer_id) ${type === "errors" ? "WHERE she.resolved_at IS NULL" : ""}`);
  return safeQuery<ActivityItem>(`SELECT * FROM (${unions.join(" UNION ALL ")}) activity ORDER BY occurred_at DESC LIMIT $1`, [limit]);
}

export type SourceRow = { monitored_source_id: string; company_name: string; source_name: string; source_url: string; priority_tier: string; enabled: boolean; last_checked_at: string | null; last_success_at: string | null; consecutive_errors: number; last_http_status: number | null; monitoring_status: string | null };
export async function getSources() {
  return safeQuery<SourceRow>(`SELECT ms.monitored_source_id::text,e.company_name,ms.source_name,ms.source_url,ms.priority_tier,ms.enabled,ms.last_checked_at,ms.last_success_at,ms.consecutive_errors,ms.last_http_status,ms.monitoring_status FROM monitored_sources ms JOIN employers e USING(employer_id) WHERE ms.enabled ORDER BY (ms.consecutive_errors>=3) DESC,ms.consecutive_errors DESC,ms.priority_tier,e.company_name,ms.source_name`);
}

export async function getSystem() {
  const [runs, backups, sources, database, alerts, digest] = await Promise.all([
    safeQuery<Run>("SELECT run_id::text,finished_at,status,requested_tiers,sources_attempted,sources_succeeded,opportunities_observed,events_created FROM monitoring_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20"),
    safeQuery<Backup & { backup_bytes: string | null; restore_verified: boolean }>("SELECT completed_at,status,backup_bytes::text,restore_verified,max(completed_at) FILTER(WHERE restore_verified) OVER() restore_verified_at FROM production_backup_runs ORDER BY started_at DESC LIMIT 10"),
    safeQuery<SourceSummary>(`SELECT count(*)::int enabled,count(*) FILTER(WHERE consecutive_errors=0)::int healthy,count(*) FILTER(WHERE consecutive_errors>=3)::int repeated_failures,count(*) FILTER(WHERE consecutive_errors>0)::int failing FROM monitored_sources WHERE enabled`),
    safeQuery<{ bytes: string; version: string }>("SELECT pg_database_size(current_database())::text bytes,current_setting('server_version') version"),
    safeQuery<{ last_created: string | null }>("SELECT max(created_at) last_created FROM alert_decisions"),
    safeQuery<{ generated_at: string | null }>("SELECT max(generated_at) generated_at FROM daily_digest_runs"),
  ]);
  let runtime = { memoryTotal: os.totalmem(), memoryFree: os.freemem(), diskTotal: 0, diskFree: 0 };
  try { const disk = await statfs(process.cwd()); runtime = { ...runtime, diskTotal: Number(disk.blocks) * Number(disk.bsize), diskFree: Number(disk.bavail) * Number(disk.bsize) }; } catch { /* graceful metric fallback */ }
  return { runs, backups, sources, database, alerts, digest, runtime, checkedAt: new Date().toISOString() };
}

export async function pingDatabase() {
  return (await query<{ ok: number }>("SELECT 1 ok"))[0]?.ok === 1;
}
