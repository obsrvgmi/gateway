import type { Metadata } from "next";
import { SettingsView } from "@/components/dashboard/views/settings";

// DashboardShell mounts this page only after localStorage restores.
export const instant = false;
export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsView />;
}
