import type { Metadata } from "next";
import { LinksView } from "@/components/dashboard/views/links";

// DashboardShell mounts this page only after localStorage restores.
export const instant = false;
export const metadata: Metadata = { title: "Payment Links" };

export default function Page() {
  return <LinksView />;
}
