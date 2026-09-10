import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, SectionError } from "@/components/ui";
import { actionLabel, getOpportunity } from "@/lib/queries";
import { exactTime, score, titleCase } from "@/lib/format";

function textList(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : typeof item === "object" && item ? String((item as { reason?: string; label?: string; description?: string }).reason || (item as { label?: string }).label || (item as { description?: string }).description || JSON.stringify(item)) : String(item));
  return [String(value)];
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const result = await getOpportunity(id);
  if (result.error && !result.data.length) return <SectionError message={result.error} />;
  const item = result.data[0]; if (!item) notFound();
  const explanation = item.explanation || {}; const blockers = textList(item.blockers); const gaps = textList(item.soft_gaps);
  const reasons = textList(explanation.match_reasons || explanation.reasons || explanation.why_fit);
  const evidence = textList(explanation.project_evidence || explanation.best_evidence || explanation.evidence);
  return <><Link href="/opportunities" className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-3.5" />Back to opportunities</Link>
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><p className="text-sm font-medium text-[var(--accent)]">{item.company_name}</p><h1 className="mt-2 max-w-4xl text-2xl font-semibold tracking-[-.03em] text-slate-950">{item.title}</h1><p className="mt-2 text-sm text-slate-500">{item.location || "Location not listed"} · {item.work_model || "Work model not listed"}</p></div>{item.job_url && <a href={item.job_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700">Open official job <ExternalLink className="size-3.5" /></a>}</div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <div className="space-y-5"><Card className="p-6"><p className="text-sm font-semibold text-slate-900">Opportunity</p><dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">{[["Type", item.opportunity_type], ["Role family", item.role_family || titleCase(item.primary_track)], ["Eligibility", titleCase(item.eligibility_status)], ["Language", item.language_requirement || titleCase(item.language_bucket)], ["First detected", exactTime(item.first_seen_at)], ["Last seen", exactTime(item.last_seen_at)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-sm font-medium text-slate-800">{value || "—"}</dd></div>)}</dl></Card>
        <Card className="p-6"><p className="text-sm font-semibold text-slate-900">Why it matches</p>{reasons.length ? <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">{reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />{reason}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">{item.role_description || "No detailed match explanation is stored."}</p>}{evidence.length > 0 && <div className="mt-6 rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Best project evidence</p><p className="mt-2 text-sm text-slate-700">{evidence.join(" · ")}</p></div>}</Card>
      </div>
      <div className="space-y-5"><Card className="p-6"><p className="text-sm font-semibold text-slate-900">Scores</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-4"><strong className="text-3xl tracking-[-.04em]">{score(item.latent_fit_score)}</strong><p className="mt-1 text-xs text-slate-500">Latent fit</p></div><div className="rounded-xl bg-slate-50 p-4"><strong className="text-3xl tracking-[-.04em]">{score(item.actionability_score)}</strong><p className="mt-1 text-xs text-slate-500">Actionability</p></div></div><div className="mt-4"><Badge tone={actionLabel(item) === "Apply now" ? "green" : "amber"}>{actionLabel(item)}</Badge></div></Card>
        <Card className="p-6"><p className="text-sm font-semibold text-slate-900">Decision context</p><div className="mt-4 space-y-5"><div><p className="text-xs text-slate-400">Biggest blockers</p><p className="mt-1 text-sm leading-6 text-slate-700">{blockers.join(" · ") || item.missing_requirements || "No hard blockers recorded."}</p></div><div><p className="text-xs text-slate-400">Soft gaps</p><p className="mt-1 text-sm leading-6 text-slate-700">{gaps.join(" · ") || "No material soft gaps recorded."}</p></div><div><p className="text-xs text-slate-400">Current recommendation</p><p className="mt-1 text-sm font-medium text-slate-800">{actionLabel(item)}</p></div></div></Card></div>
    </div>
  </>;
}
