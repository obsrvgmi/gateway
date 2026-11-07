import type { Metadata } from "next";
import { OverviewView } from "@/components/dashboard/views/overview";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <OverviewView />;
}
