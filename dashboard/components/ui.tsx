import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Circle, XCircle } from "lucide-react";
import type { Status } from "@/lib/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)] ${className}`}>{children}</section>;
}

export function SectionError({ message = "This section is temporarily unavailable." }: { message?: string }) {
  return <div className="flex min-h-28 items-center justify-center rounded-xl bg-slate-50 px-5 text-center text-sm text-slate-500"><AlertCircle className="mr-2 size-4" />{message}</div>;
}

export function StatusDot({ status, label }: { status: Status; label?: string }) {
  const Icon = status === "healthy" ? CheckCircle2 : status === "degraded" ? Circle : XCircle;
  return <span className={`inline-flex items-center gap-1.5 text-sm font-medium status-${status}`}><Icon className="size-3.5" fill="currentColor" strokeWidth={status === "degraded" ? 0 : 2.5} />{label ?? (status === "down" ? "Down" : status[0].toUpperCase() + status.slice(1))}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl bg-slate-50 px-6 py-10 text-center"><p className="text-sm font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{detail}</p></div>;
}
