import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { OpportunityList } from "@/components/opportunity-list";
import { Card, SectionError } from "@/components/ui";
import { getOpportunities } from "@/lib/queries";

const filters = [["all", "All"], ["strong", "Strong matches"], ["student", "Student"], ["apply", "Apply now"], ["future", "Future"], ["closed", "Closed"]];

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ filter?: string; location?: string; role?: string }> }) {
  const params = await searchParams;
  const active = filters.some(([key]) => key === params.filter) ? params.filter! : "all";
  const result = await getOpportunities(active, params.location || "", params.role || "");
  return <><PageHeader title="Opportunities" subtitle="Prioritized using your existing fit and actionability scores" />
    <Card className="p-4 sm:p-5"><div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-4">{filters.map(([key, label]) => <Link key={key} href={`/opportunities?filter=${key}`} className={`filter-link ${active === key ? "filter-link-active" : ""}`}>{label}</Link>)}</div>
      <form className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_auto]"><input type="hidden" name="filter" value={active} /><input className="input" name="location" defaultValue={params.location} placeholder="Location" /><input className="input" name="role" defaultValue={params.role} placeholder="Role family" /><button className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-700">Filter</button></form>
      <p className="mb-1 text-xs text-slate-400">{result.data.length} opportunities</p>{result.error ? <SectionError /> : <OpportunityList items={result.data} />}</Card>
  </>;
}
