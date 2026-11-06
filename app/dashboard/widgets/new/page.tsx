import type { Metadata } from "next";
import { WidgetNewView } from "@/components/dashboard/views/widget-new";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Customize widget" };

export default function Page() {
  return <WidgetNewView />;
}
