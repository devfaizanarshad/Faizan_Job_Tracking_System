import Link from "next/link";
import { ArrowRight, Database, RadioTower, ShieldCheck } from "lucide-react";
import { ActivityFeed } from "@/components/activity-feed";
import { OpportunityList } from "@/components/opportunity-list";
import { PageHeader } from "@/components/page-header";
import { Card, SectionError, StatusDot } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { getOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const overview = await getOverview();
  const snapshot = overview.snapshot.data[0];
  const sources = overview.sources.data[0];
  const metrics = [["Live Jobs", snapshot?.total_live_opportunities], ["Relevant", snapshot?.relevant_live_opportunities], ["Strong Matches", snapshot?.strong_live_opportunities], ["Student Roles", snapshot?.student_live_opportunities]];
  return <>
    <PageHeader title="Job Intelligence" subtitle="Your Germany opportunity monitor" updatedAt={overview.checkedAt} status={overview.status} />
    <div className="grid gap-5 xl:grid-cols-[1.1fr_1.9fr]">
      <Card className="p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">System health</p><div className="mt-3"><StatusDot status={overview.status} label={overview.status === "healthy" ? "System healthy" : overview.status === "degraded" ? "System operational" : "System down"} /></div></div><span className="grid size-10 place-items-center rounded-xl bg-slate-50 text-slate-500"><ShieldCheck className="size-5" /></span></div>
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">{[["S Monitor", overview.checks.sMonitor], ["A Monitor", overview.checks.aMonitor], ["PostgreSQL", overview.checks.database], ["Alert Engine", overview.checks.alertEngine], ["Backup", overview.checks.backup]].map(([label, status]) => <div className="flex items-center justify-between gap-3" key={label}><span className="text-slate-500">{label}</span><StatusDot status={status as "healthy" | "degraded" | "down"} /></div>)}</div>
        <div className="mt-6 border-t border-[var(--border)] pt-4 text-xs leading-6 text-slate-500"><p>Last S run: <span className="text-slate-800">{relativeTime(overview.runs.s?.finished_at)}</span></p><p>Last A run: <span className="text-slate-800">{relativeTime(overview.runs.a?.finished_at)}</span></p><p>Last backup: <span className="text-slate-800">{relativeTime(overview.backup?.completed_at)}</span></p></div>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{metrics.map(([label, value]) => <Card key={label} className="flex min-h-32 flex-col justify-between p-5"><span className="text-xs font-medium text-slate-500">{label}</span><strong className="text-3xl font-semibold tracking-[-.04em] text-slate-950">{value ?? "—"}</strong></Card>)}</div>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <Card className="p-5 sm:p-6"><div className="mb-2 flex items-center justify-between"><div><p className="text-base font-semibold text-slate-950">Today</p><p className="mt-1 text-xs text-slate-500">Best current opportunities from your validated ranking model.</p></div><Link href="/opportunities" className="text-xs font-semibold text-[var(--accent)]">View all</Link></div>{overview.actions.error ? <SectionError /> : <OpportunityList items={overview.actions.data} compact />}</Card>
      <Card className="p-5 sm:p-6"><div className="mb-2"><p className="text-base font-semibold text-slate-950">Recent activity</p><p className="mt-1 text-xs text-slate-500">Meaningful changes across jobs and monitors.</p></div>{overview.activity.error ? <SectionError /> : <ActivityFeed items={overview.activity.data} />}</Card>
    </div>
    <Card className="mt-5 flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6"><div className="flex items-center gap-4"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-[var(--accent)]"><RadioTower className="size-5" /></span><div><p className="text-sm font-semibold text-slate-900">{sources?.enabled ?? "—"} sources monitored</p><p className="mt-1 text-xs text-slate-500">{sources ? `${sources.healthy} healthy · ${sources.repeated_failures} repeated failures` : "Source health is unavailable"}</p>{sources?.repeated_failures ? <p className="mt-1 text-xs font-medium text-amber-700">System operational · {sources.repeated_failures} sources need attention</p> : <p className="mt-1 text-xs text-emerald-700">All monitored sources are healthy.</p>}</div></div><Link href="/sources" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">View sources <ArrowRight className="size-3.5" /></Link></Card>
    <div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Database className="size-3.5" />Dashboard queries are read-only and refresh on normal page loads.</div>
  </>;
}
