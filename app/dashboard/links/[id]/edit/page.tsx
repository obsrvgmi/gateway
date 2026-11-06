import type { Metadata } from "next";
import { Suspense } from "react";
import { LinkEditView } from "@/components/dashboard/views/link-new";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Edit link" };

export default function Page() {
  return (
    <Suspense>
      <LinkEditView />
    </Suspense>
  );
}
