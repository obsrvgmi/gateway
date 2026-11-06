import type { Metadata } from "next";
import { LinkNewView } from "@/components/dashboard/views/link-new";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "New payment link" };

export default function Page() {
  return <LinkNewView />;
}
