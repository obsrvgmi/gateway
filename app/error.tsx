"use client";

import { useEffect } from "react";
import { Button } from "@/components/base/buttons/button";
import { actions } from "@/lib/store";

/** Catches what the dashboard's own boundary can't: its layout, where the rail reads the store, sits above it. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline-semibold">Something went wrong</h1>
        <p className="max-w-[44ch] text-body-regular text-text-secondary">The demo data saved in this browser may be damaged. Restoring it usually fixes this.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => { actions.restoreDemoData(); retry(); }}>Restore demo data</Button>
        <Button variant="secondary" onClick={retry}>Try again</Button>
      </div>
    </main>
  );
}
