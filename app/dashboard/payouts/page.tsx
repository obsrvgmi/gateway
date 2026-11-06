import type { Metadata } from "next";
import { PayoutsView } from "@/components/dashboard/views/payouts";

// DashboardShell mounts this page only after localStorage restores.
export const instant = false;
export const metadata: Metadata = { title: "Payouts" };

export default function Page() {
  return <PayoutsView />;
}
