"use client";

import { Suspense, useState, type ReactNode } from "react";
import { RiMenuLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Drawer } from "@/components/base/drawer/drawer";
import { Logo } from "@/components/brand/logo";
import { useGatewayReady } from "@/lib/store";
import { AppSidebar } from "./app-sidebar";
import { PageSkeleton } from "./skeletons";

export function DashboardShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Views mount only after localStorage is restored, so no form can seed itself from stale data.
  const ready = useGatewayReady();
  return (
    <div className="dash-root min-h-dvh bg-background-secondary-default">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-background-primary-default focus:p-2 focus:text-body-medium">Skip to content</a>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-separator-border bg-background-secondary-default px-4 py-2 lg:hidden">
        <Logo />
        <Button variant="ghost" iconOnly leadingIcon={RiMenuLine} aria-label="Open navigation" onClick={() => setOpen(true)} />
      </header>
      <Drawer isOpen={open} onOpenChange={setOpen} placement="end" size="sm" aria-label="Navigation" className="p-0">
        <AppSidebar onNavigate={() => setOpen(false)} className="w-full rounded-none border-0 shadow-none" />
      </Drawer>
      <div className="mx-auto flex max-w-[1560px] gap-4 px-3 sm:px-4 lg:gap-6 lg:px-6">
        <main id="main" tabIndex={-1} className="@container min-w-0 flex-1 py-4 outline-none lg:py-6">
          <div className="flex flex-col gap-4 @3xl:gap-5">{ready ? children : <PageSkeleton />}</div>
        </main>
        <div className="sticky top-4 my-4 hidden h-[calc(100dvh-2rem)] shrink-0 lg:block">
          {/* usePathname suspends under a dynamic param unknown at build time, such as a widget id. */}
          <Suspense fallback={<div className="h-full w-[260px] rounded-3xl border border-border-button-white bg-background-primary-default shadow-sidebar" />}>
            <AppSidebar />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
