import { BriefcaseBusiness, CheckCircle2, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import type { ActivityItem } from "@/lib/queries";
import { exactTime } from "@/lib/format";
import { EmptyState } from "./ui";

function icon(kind: string) {
  if (kind === "NEW_JOB" || kind === "STUDENT_ROLE_ADDED") return BriefcaseBusiness;
  if (kind === "JOB_CLOSED" || kind === "JOB_REMOVED") return XCircle;
  if (kind === "SOURCE_FAILED") return TriangleAlert;
  if (kind === "SOURCE_RECOVERED") return CheckCircle2;
  if (kind === "MONITOR_COMPLETED") return CheckCircle2;
  return RefreshCw;
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <EmptyState title="No meaningful changes" detail="Nothing new has been recorded since the last monitor run." />;
  return <div className="divide-y divide-[var(--border)]">{items.map((item) => { const Icon = icon(item.kind); return <div key={item.id} className="flex gap-3 py-4"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="truncate text-sm font-medium text-slate-900">{item.title || item.company_name || "System monitor"}</p><time className="text-xs text-slate-400">{exactTime(item.occurred_at, { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-0.5 text-xs text-slate-500">{item.company_name && item.title ? `${item.company_name} · ` : ""}{item.detail}</p></div></div>; })}</div>;
}
