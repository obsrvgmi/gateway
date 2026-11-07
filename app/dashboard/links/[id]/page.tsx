import type { Metadata } from "next";
import { Suspense } from "react";
import { SourceDetailView } from "@/components/dashboard/views/source-detail";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Link details" };

export default function Page() {
  return <Suspense><SourceDetailView kind="link" /></Suspense>;
}
