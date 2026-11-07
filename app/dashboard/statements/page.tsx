import type { Metadata } from "next";
import { StatementsView } from "@/components/dashboard/views/statements";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Statements" };

export default function Page() {
  return <StatementsView />;
}
