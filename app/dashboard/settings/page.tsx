import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsView } from "@/components/dashboard/views/settings";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
