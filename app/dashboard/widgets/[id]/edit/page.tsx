import type { Metadata } from "next";
import { Suspense } from "react";
import { WidgetEditView } from "@/components/dashboard/views/widget-new";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Edit widget" };

export default function Page() {
  return (
    <Suspense>
      <WidgetEditView />
    </Suspense>
  );
}
