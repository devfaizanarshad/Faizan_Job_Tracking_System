import { StatusDot } from "./ui";
import { exactTime } from "@/lib/format";
import type { Status } from "@/lib/types";

export function PageHeader({ title, subtitle, updatedAt, status }: { title: string; subtitle: string; updatedAt?: string; status?: Status }) {
  return <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><h1 className="text-[26px] font-semibold tracking-[-.03em] text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
    {updatedAt && <div className="flex items-center gap-3 text-xs text-slate-400"><span>Updated {exactTime(updatedAt)}</span>{status && <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1"><StatusDot status={status} /></span>}</div>}
  </header>;
}
