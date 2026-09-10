import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { PageHeader } from "@/components/page-header";
import { Card, SectionError } from "@/components/ui";
import { getActivity } from "@/lib/queries";

const filters = [["all", "All"], ["new", "New"], ["changed", "Changed"], ["closed", "Closed"], ["errors", "Errors"]];
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const params = await searchParams; const active = filters.some(([key]) => key === params.filter) ? params.filter! : "all"; const result = await getActivity(100, active);
  return <><PageHeader title="Activity" subtitle="Meaningful opportunity and monitoring events—not raw logs" /><Card className="p-5 sm:p-6"><div className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-4">{filters.map(([key, label]) => <Link key={key} href={`/activity?filter=${key}`} className={`filter-link ${active === key ? "filter-link-active" : ""}`}>{label}</Link>)}</div>{result.error ? <SectionError /> : <ActivityFeed items={result.data} />}</Card></>;
}
