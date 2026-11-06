"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useGatewayReady } from "@/lib/store";
import { AppSidebar } from "./app-sidebar";
import { preloadDashboardExtras } from "./preload";
import { PageSkeleton } from "./skeletons";
import { TopBar } from "./top-bar";

const Drawer = dynamic(() => import("@/components/base/drawer/drawer").then((module) => module.Drawer), { ssr: false });

export function DashboardShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Views mount only after localStorage is restored, so no form can seed itself from stale data.
  const ready = useGatewayReady();
  const [navArmed, setNavArmed] = useState(false);
  if (open && !navArmed) setNavArmed(true);
  useEffect(preloadDashboardExtras, []);
  return (
    <div className="dash-root flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-background-primary-default focus:p-2 focus:text-body-medium">Skip to content</a>
      {navArmed && (
        <Drawer isOpen={open} onOpenChange={setOpen} placement="start" size="sm" aria-label="Navigation" className="p-0">
          <Suspense>
            <AppSidebar onNavigate={() => setOpen(false)} className="[--rail-width:100%]" />
          </Suspense>
        </Drawer>
      )}
      <div className="sticky top-0 hidden h-dvh shrink-0 overflow-y-auto lg:block">
        {/* usePathname suspends under a dynamic param unknown at build time, such as a widget id. */}
        <Suspense fallback={<div className="dash-rail" />}>
          <AppSidebar />
        </Suspense>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="dash-bar" />}>
          <TopBar onOpenNavigation={() => setOpen(true)} />
        </Suspense>
        <main id="main" tabIndex={-1} className="@container mx-auto w-full max-w-[calc(var(--dash-max)+2.5rem)] min-w-0 flex-1 px-3 py-4 outline-none sm:px-5 lg:py-5">
          <div className="flex flex-col gap-4">{ready ? children : <PageSkeleton />}</div>
        </main>
      </div>
    </div>
  );
}
