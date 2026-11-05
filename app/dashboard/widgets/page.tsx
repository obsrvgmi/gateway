import type { Metadata } from "next";
import { WidgetsView } from "@/components/dashboard/views/widgets";

// DashboardShell mounts this page only after localStorage restores.
export const instant = false;
export const metadata: Metadata = { title: "Widgets" };

export default function Page() {
  return <WidgetsView />;
}
