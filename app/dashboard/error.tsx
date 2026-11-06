"use client";

import { useEffect } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Panel } from "@/components/dashboard/ui";
import { actions } from "@/lib/store";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Panel className="items-center py-12 text-center">
      <span className="dash-well flex size-12 items-center justify-center rounded-2xl">
        <RiErrorWarningLine className="size-6 text-foreground-icon-secondary" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-headline-semibold">This page didn&apos;t load</h1>
        <p className="max-w-[44ch] text-body-regular text-text-secondary">Try again. If it keeps happening, the demo data saved in this browser may be damaged, and restoring it will fix that.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Button variant="secondary" onClick={() => { actions.restoreDemoData(); retry(); }}>Restore demo data</Button>
      </div>
    </Panel>
  );
}
