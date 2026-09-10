import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";

export const metadata: Metadata = { title: "Job Intelligence", description: "Private Germany opportunity monitor" };
export const dynamic = "force-dynamic";
export const revalidate = 300;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
