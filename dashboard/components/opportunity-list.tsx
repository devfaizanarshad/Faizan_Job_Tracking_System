import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { actionLabel } from "@/lib/queries";
import { relativeTime, score, titleCase } from "@/lib/format";
import type { RankedOpportunity } from "@/lib/types";
import { Badge, EmptyState } from "./ui";

const tone = (label: string) => label === "Apply now" ? "green" : label === "Review" ? "blue" : label === "Future" ? "amber" : label === "Blocked" ? "red" : "neutral";

export function OpportunityList({ items, compact = false }: { items: RankedOpportunity[]; compact?: boolean }) {
  if (!items.length) return <EmptyState title="Nothing urgent right now." detail="Your monitors are running normally." />;
  return <div className="divide-y divide-[var(--border)]">{items.map((item) => {
    const label = actionLabel(item);
    return <Link href={`/opportunities/${item.opportunity_id}`} key={item.opportunity_id} className="group grid gap-3 px-1 py-4 transition hover:bg-slate-50/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3">
      <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><ArrowUpRight className="size-3.5 shrink-0 text-slate-300 transition group-hover:text-[var(--accent)]" /></div><p className="mt-1 truncate text-xs text-slate-500">{item.company_name} · {item.location || "Location not listed"}{!compact && (item.opportunity_type || item.primary_track) ? ` · ${titleCase(item.opportunity_type || item.primary_track)}` : ""}</p></div>
      <div className="flex items-center gap-3">{!compact && <span className="hidden max-w-28 truncate text-xs text-slate-400 lg:block">{titleCase(item.eligibility_status)}</span>}<span className="text-xs text-slate-500"><strong className="font-semibold text-slate-800">{score(item.latent_fit_score)}</strong> Fit</span><span className="text-xs text-slate-500"><strong className="font-semibold text-slate-800">{score(item.actionability_score)}</strong> Actionability</span><Badge tone={tone(label)}>{label}</Badge>{!compact && <span className="hidden w-16 text-right text-xs text-slate-400 xl:block">{relativeTime(item.first_seen_at)}</span>}</div>
    </Link>;
  })}</div>;
}
