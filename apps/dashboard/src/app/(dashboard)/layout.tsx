"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <div className="px-4 md:px-6 py-5 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
