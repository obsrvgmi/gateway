import type { Metadata } from "next";
import { NotificationsView } from "@/components/dashboard/views/notifications";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <NotificationsView />;
}
