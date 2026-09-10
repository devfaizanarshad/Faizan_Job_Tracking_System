import Link from "next/link";
import { Activity, BriefcaseBusiness, LayoutDashboard, Menu, RadioTower, Settings2 } from "lucide-react";

const links = [
  ["/", "Overview", LayoutDashboard],
  ["/opportunities", "Opportunities", BriefcaseBusiness],
  ["/activity", "Activity", Activity],
  ["/sources", "Sources", RadioTower],
  ["/system", "System", Settings2],
] as const;

function Navigation() {
  return <nav className="space-y-1">{links.map(([href, label, Icon]) => <Link key={href} href={href} className="nav-link"><Icon className="size-[18px]" strokeWidth={1.8} /><span>{label}</span></Link>)}</nav>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[var(--canvas)]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-[var(--border)] bg-white px-4 py-6 lg:block">
      <Link href="/" className="mb-8 flex items-center gap-3 px-2"><span className="grid size-8 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">J</span><span className="text-sm font-semibold tracking-tight">Job Intelligence</span></Link>
      <Navigation />
      <p className="absolute bottom-6 left-6 text-xs text-slate-400">Private dashboard</p>
    </aside>
    <div className="lg:pl-60">
      <div className="sticky top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-white/95 px-4 backdrop-blur lg:hidden">
        <details className="group relative"><summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg hover:bg-slate-100"><Menu className="size-5" /><span className="sr-only">Open navigation</span></summary><div className="absolute left-0 top-11 w-56 rounded-2xl border border-[var(--border)] bg-white p-3 shadow-xl"><Navigation /></div></details>
        <span className="ml-3 text-sm font-semibold">Job Intelligence</span>
      </div>
      <main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">{children}</main>
    </div>
  </div>;
}
